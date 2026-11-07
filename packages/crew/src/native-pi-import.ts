import { randomUUID } from "node:crypto";
import { mkdir, lstat, realpath, writeFile, rm } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
interface ImportRuntime {
  session: { isStreaming: boolean };
  importFromJsonl(
    path: string,
    cwdOverride: string,
  ): Promise<{ cancelled: boolean }>;
}
export class NativePiImport {
  private pending:
    { token: string; text: string; id: string; expires: number } | undefined;
  constructor(
    private readonly runtime: ImportRuntime,
    private readonly cwd: string,
    private readonly ids: () => Promise<string[]>,
  ) {}
  preview(text: string) {
    this.pending = undefined;
    if (
      this.runtime.session.isStreaming ||
      Buffer.byteLength(text) > 524288 ||
      text.includes("\0")
    )
      throw Error("Invalid or busy session import");
    const lines = text.trim().split(/\r?\n/);
    if (lines.length > 4096) throw Error("Import exceeds entry limit");
    const records = lines.map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );
    if (
      records.some(
        (record) =>
          !record || typeof record !== "object" || Array.isArray(record),
      )
    )
      throw Error("Invalid import records");
    const header = records[0]!;
    if (
      header.type !== "session" ||
      header.version !== 3 ||
      typeof header.id !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        header.id,
      ) ||
      typeof header.cwd !== "string" ||
      !isAbsolute(header.cwd) ||
      header.cwd.length > 4096 ||
      /[\r\n]/.test(header.cwd) ||
      typeof header.timestamp !== "string" ||
      !Number.isFinite(Date.parse(header.timestamp))
    )
      throw Error("Unsupported session header");
    const seen = new Set<string>();
    for (const record of records.slice(1)) {
      if (
        typeof record.type !== "string" ||
        record.type === "session" ||
        typeof record.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(record.id) ||
        seen.has(record.id) ||
        (record.parentId !== null &&
          (typeof record.parentId !== "string" || !seen.has(record.parentId)))
      )
        throw Error("Invalid session tree");
      seen.add(record.id);
    }
    const token = randomUUID();
    // The source remains untouched. The user explicitly reviews these changes before commit.
    records[0] = {
      type: "session",
      version: 3,
      id: header.id,
      timestamp: header.timestamp,
      cwd: this.cwd,
    };
    this.pending = {
      token,
      id: header.id,
      text: records.map((record) => JSON.stringify(record)).join("\n") + "\n",
      expires: Date.now() + 600000,
    };
    return {
      kind: "import-review" as const,
      token,
      sessionId: header.id,
      originalCwd: header.cwd,
      targetCwd: this.cwd,
      entries: records.length - 1,
      removedParent: typeof header.parentSession === "string",
    };
  }
  async confirm(token: string) {
    const pending = this.pending;
    this.pending = undefined;
    if (
      !pending ||
      pending.token !== token ||
      pending.expires < Date.now() ||
      this.runtime.session.isStreaming
    )
      throw Error("Import review expired or unavailable");
    if ((await this.ids()).includes(pending.id))
      throw Error("Session ID already exists; resume it instead");
    const directory = join(this.cwd, "import-staging");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0 ||
      (process.getuid && info.uid !== process.getuid()) ||
      (await realpath(directory)) !== directory
    )
      throw Error("Unsafe import staging");
    const path = join(directory, randomUUID() + ".jsonl");
    await writeFile(path, pending.text, { flag: "wx", mode: 0o600 });
    try {
      const result = await this.runtime.importFromJsonl(path, this.cwd);
      return {
        kind: "message" as const,
        text: result.cancelled
          ? "Import cancelled by the session."
          : "Session imported into Amun. ID retained; original file unchanged.",
      };
    } finally {
      await rm(path, { force: true });
    }
  }
}
