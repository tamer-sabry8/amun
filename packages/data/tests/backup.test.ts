import { workspaceIdentity } from "../src/identity.ts";
import { it, expect } from "vitest";
import Database from "better-sqlite3";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  statSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkspace } from "../src/workspace.ts";
import { exportWorkspace, restoreWorkspace } from "../src/backup.ts";
import { Redactor } from "../../security/src/redaction.ts";
it("encrypts a SQLite snapshot and allowed artifacts, then restores into an empty workspace without credentials", async () => {
  const root = mkdtempSync(join(tmpdir(), "amun-backup-"));
  const source = join(root, "source");
  const db = openWorkspace(source, Database);
  const secret = "CANARY-provider-secret-987";
  const redactor = new Redactor();
  redactor.register(secret);
  try {
    db.prepare("INSERT INTO products(id,name,created_at) VALUES (?,?,?)").run(
      "p",
      "Saved product",
      "now",
    );
    mkdirSync(join(source, "artifacts"));
    writeFileSync(join(source, "artifacts", "note.md"), "Saved artifact");
    writeFileSync(join(source, "auth.json"), secret);
    db.prepare(
      "INSERT INTO artifacts(id,product_id,kind,path_or_uri) VALUES (?,?,?,?)",
    ).run("a", "p", "markdown", "note.md");
    workspaceIdentity(db);
    const archive = join(root, "backup.amun");
    await exportWorkspace(
      db,
      source,
      archive,
      "correct horse battery",
      redactor,
    );
    const bytes = readFileSync(archive);
    expect(bytes.includes(Buffer.from("Saved product"))).toBe(false);
    expect(bytes.includes(Buffer.from(secret))).toBe(false);
    expect(statSync(archive).mode & 0o777).toBe(0o600);
    const target = join(root, "restored");
    await restoreWorkspace(archive, target, "correct horse battery", Database);
    const restored = openWorkspace(target, Database);
    expect(workspaceIdentity(restored)).not.toBe(workspaceIdentity(db));
    expect(restored.prepare("SELECT name FROM products").get()).toEqual({
      name: "Saved product",
    });
    restored.close();
    expect(readFileSync(join(target, "artifacts", "note.md"), "utf8")).toBe(
      "Saved artifact",
    );
    expect(existsSync(join(target, "auth.json"))).toBe(false);
    await expect(
      restoreWorkspace(archive, target, "correct horse battery", Database),
    ).rejects.toThrow();
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
it("rejects wrong passwords, modified ciphertext, unsafe artifact paths and secret-bearing content", async () => {
  const root = mkdtempSync(join(tmpdir(), "amun-backup-"));
  const source = join(root, "source");
  const db = openWorkspace(source, Database);
  const redactor = new Redactor();
  redactor.register("CANARY-artifact-secret");
  try {
    db.prepare("INSERT INTO products(id,name,created_at) VALUES (?,?,?)").run(
      "p",
      "Product",
      "now",
    );
    const archive = join(root, "backup.amun");
    await exportWorkspace(
      db,
      source,
      archive,
      "correct horse battery",
      redactor,
    );
    const target = join(root, "restored");
    await expect(
      restoreWorkspace(archive, target, "incorrect password", Database),
    ).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
    const modified = readFileSync(archive);
    modified[modified.length - 1] = modified[modified.length - 1]! ^ 1;
    writeFileSync(join(root, "bad.amun"), modified);
    await expect(
      restoreWorkspace(
        join(root, "bad.amun"),
        target,
        "correct horse battery",
        Database,
      ),
    ).rejects.toThrow();
    mkdirSync(join(source, "artifacts"));
    writeFileSync(join(root, "outside"), "private");
    symlinkSync(join(root, "outside"), join(source, "artifacts", "link"));
    db.prepare(
      "INSERT INTO artifacts(id,product_id,kind,path_or_uri) VALUES (?,?,?,?)",
    ).run("a", "p", "file", "link");
    await expect(
      exportWorkspace(
        db,
        source,
        join(root, "unsafe.amun"),
        "correct horse battery",
        redactor,
      ),
    ).rejects.toThrow();
    db.prepare("UPDATE artifacts SET path_or_uri=?").run("../outside");
    await expect(
      exportWorkspace(
        db,
        source,
        join(root, "unsafe.amun"),
        "correct horse battery",
        redactor,
      ),
    ).rejects.toThrow();
    db.prepare("DELETE FROM artifacts").run();
    db.prepare("UPDATE products SET name=?").run("CANARY-artifact-secret");
    await expect(
      exportWorkspace(
        db,
        source,
        join(root, "unsafe.amun"),
        "correct horse battery",
        redactor,
      ),
    ).rejects.toThrow();
    expect(existsSync(join(root, "unsafe.amun"))).toBe(false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
