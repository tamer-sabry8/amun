import {
  createCipheriv,
  createDecipheriv,
  randomUUID,
  randomBytes,
  scrypt,
} from "node:crypto";
import { promisify } from "node:util";
import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  rename,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type Database from "better-sqlite3";
import type { Redactor } from "../../security/src/redaction.ts";
import { migrate } from "./database.ts";
const derive = promisify(scrypt);
const magic = Buffer.from("AMUNB001");
const limit = 64 * 1024 * 1024;
function passphrase(value: string): void {
  if (value.length < 12 || value.length > 1024)
    throw Error("Backup passphrase must contain 12–1024 characters");
}
function artifactName(value: string): string {
  if (
    !value ||
    value.length > 1024 ||
    isAbsolute(value) ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.split("/").some((p) => !p || p === "." || p === "..") ||
    /(^|\/)(?:\.env(?:\..*)?|auth\.json|credentials(?:\.json)?|.*\.(?:pem|key))$/i.test(
      value,
    )
  )
    throw Error("Unsafe artifact path");
  return value;
}
async function readArtifact(root: string, name: string): Promise<Buffer> {
  const path = join(root, artifactName(name));
  let current = root;
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw Error("Unsafe artifact root");
  for (const part of name.split("/")) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || (current !== path && !stat.isDirectory()))
      throw Error("Unsafe artifact link");
  }
  const stat = await lstat(path);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16 * 1024 * 1024)
    throw Error("Artifact is not an allowed bounded file");
  return readFile(path);
}
function assertNoSecrets(db: Database.Database, redactor: Redactor): void {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as { name: string }[];
  for (const { name } of tables) {
    if (!/^[a-z_0-9]+$/.test(name)) throw Error("Unexpected workspace table");
    for (const row of db
      .prepare(`SELECT * FROM "${name}"`)
      .iterate() as Iterable<Record<string, unknown>>) {
      for (const [column, value] of Object.entries(row))
        if (typeof value === "string") {
          if (redactor.text(value) !== value)
            throw Error("Workspace contains secret-bearing data");
          if (column.endsWith("_json")) {
            const parsed: unknown = JSON.parse(value);
            if (
              JSON.stringify(parsed) !== JSON.stringify(redactor.clean(parsed))
            )
              throw Error("Workspace contains credential fields");
          }
        }
    }
  }
}
export async function exportWorkspace(
  db: Database.Database,
  root: string,
  destination: string,
  password: string,
  redactor: Redactor,
): Promise<void> {
  passphrase(password);
  if (!isAbsolute(root) || !isAbsolute(destination))
    throw Error("Backup paths must be absolute");
  const temporary = await mkdtemp(join(root, ".backup-"));
  try {
    const snapshot = join(temporary, "workspace.sqlite");
    await db.backup(snapshot);
    await chmod(snapshot, 0o600);
    const Native = db.constructor as typeof Database;
    const copy = new Native(snapshot);
    const artifacts: { name: string; data: string }[] = [];
    try {
      assertNoSecrets(copy, redactor);
      const rows = copy
        .prepare("SELECT path_or_uri FROM artifacts ORDER BY id")
        .all() as { path_or_uri: string }[];
      const names = new Set<string>();
      let total = 0;
      for (const row of rows) {
        const name = artifactName(row.path_or_uri);
        if (names.has(name)) continue;
        names.add(name);
        const bytes = await readArtifact(join(root, "artifacts"), name);
        total += bytes.length;
        if (total > limit / 2) throw Error("Artifact size limit");
        if (redactor.text(bytes.toString("utf8")) !== bytes.toString("utf8"))
          throw Error("Artifact contains secret-bearing data");
        artifacts.push({ name, data: bytes.toString("base64") });
      }
      copy.exec("VACUUM");
    } finally {
      copy.close();
    }
    const database = await readFile(snapshot);
    if (database.length > limit / 2) throw Error("Workspace size limit");
    const clear = Buffer.from(
      JSON.stringify({
        version: 1,
        database: database.toString("base64"),
        artifacts,
        requiresReauthentication: true,
      }),
    );
    if (clear.length > limit) throw Error("Backup size limit");
    const salt = randomBytes(16),
      iv = randomBytes(12);
    const key = (await derive(password, salt, 32)) as Buffer;
    try {
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(magic);
      const encrypted = Buffer.concat([cipher.update(clear), cipher.final()]);
      await writeFile(
        destination,
        Buffer.concat([magic, salt, iv, cipher.getAuthTag(), encrypted]),
        { mode: 0o600, flag: "wx" },
      );
    } finally {
      key.fill(0);
      clear.fill(0);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
function base64(value: unknown): Buffer {
  if (typeof value !== "string" || value.length > limit * 2)
    throw Error("Invalid backup content");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value)
    throw Error("Invalid backup encoding");
  return bytes;
}
export async function restoreWorkspace(
  archive: string,
  target: string,
  password: string,
  Native: typeof Database,
): Promise<void> {
  passphrase(password);
  if (!isAbsolute(archive) || !isAbsolute(target))
    throw Error("Backup paths must be absolute");
  try {
    await lstat(target);
    throw Error("Restore target already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const stat = await lstat(archive);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > limit + 52 ||
    stat.size < 53
  )
    throw Error("Invalid backup file");
  const bytes = await readFile(archive);
  if (!bytes.subarray(0, 8).equals(magic))
    throw Error("Unsupported backup format");
  const key = (await derive(password, bytes.subarray(8, 24), 32)) as Buffer;
  let clear: Buffer;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      bytes.subarray(24, 36),
    );
    decipher.setAAD(magic);
    decipher.setAuthTag(bytes.subarray(36, 52));
    clear = Buffer.concat([
      decipher.update(bytes.subarray(52)),
      decipher.final(),
    ]);
  } catch {
    throw Error("Backup authentication failed");
  } finally {
    key.fill(0);
  }
  let payload: {
    version?: unknown;
    database?: unknown;
    artifacts?: unknown;
    requiresReauthentication?: unknown;
  };
  try {
    payload = JSON.parse(clear.toString("utf8")) as typeof payload;
  } finally {
    clear.fill(0);
  }
  if (
    !payload ||
    payload.version !== 1 ||
    payload.requiresReauthentication !== true ||
    !Array.isArray(payload.artifacts) ||
    payload.artifacts.length > 10000
  )
    throw Error("Invalid backup manifest");
  const temporary = await mkdtemp(join(dirname(target), ".amun-restore-"));
  try {
    await chmod(temporary, 0o700);
    const file = join(temporary, "workspace.sqlite");
    await writeFile(file, base64(payload.database), {
      mode: 0o600,
      flag: "wx",
    });
    const db = new Native(file);
    try {
      db.pragma("trusted_schema = OFF");
      if (db.pragma("integrity_check", { simple: true }) !== "ok")
        throw Error("Invalid backup database");
      const expected = new Native(":memory:");
      try {
        migrate(
          expected,
          db.pragma("user_version", { simple: true }) as number,
        );
        const sql =
          "SELECT type,name,sql FROM sqlite_master WHERE type IN ('trigger','view') ORDER BY type,name";
        if (
          JSON.stringify(db.prepare(sql).all()) !==
          JSON.stringify(expected.prepare(sql).all())
        )
          throw Error("Unexpected executable schema");
      } finally {
        expected.close();
      }
      migrate(db);
      if ((db.pragma("foreign_key_check") as unknown[]).length)
        throw Error("Invalid backup references");
      // Restored workspaces never retain executable approvals or blindly resume writes.
      db.transaction(() => {
        db.prepare(
          "UPDATE workspace_settings SET value_json=? WHERE id='workspace_identity'",
        ).run(JSON.stringify(randomUUID()));
        db.prepare(
          "UPDATE approvals SET invalidated_reason='Workspace restored; reapproval required' WHERE invalidated_reason IS NULL",
        ).run();
        db.prepare(
          "UPDATE actions SET state='invalidated' WHERE state='approved'",
        ).run();
        db.prepare(
          "UPDATE actions SET state='unknown' WHERE state='executing'",
        ).run();
        db.prepare(
          "UPDATE outbox SET state='waiting' WHERE state='ready'",
        ).run();
        db.prepare(
          "UPDATE outbox SET state='unknown' WHERE state='executing'",
        ).run();
      }).immediate();
    } finally {
      db.close();
    }
    const names = new Set<string>();
    for (const entry of payload.artifacts as unknown[]) {
      if (
        !entry ||
        typeof entry !== "object" ||
        !("name" in entry) ||
        typeof entry.name !== "string" ||
        !("data" in entry)
      )
        throw Error("Invalid artifact manifest");
      const name = artifactName(entry.name);
      if (names.has(name)) throw Error("Duplicate artifact");
      names.add(name);
      const data = base64(entry.data);
      if (data.length > 16 * 1024 * 1024) throw Error("Artifact size limit");
      const path = resolve(temporary, "artifacts", name);
      if (!path.startsWith(join(temporary, "artifacts") + sep))
        throw Error("Unsafe artifact path");
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, data, { mode: 0o600, flag: "wx" });
    }
    // The selected target must still be absent; never replace a user workspace.
    try {
      await lstat(target);
      throw Error("Restore target already exists");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(temporary, target);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
