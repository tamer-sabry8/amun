import type Database from "better-sqlite3";
import {
  classifyTool,
  knownTools,
  type KnownTool,
  type ProbeResult,
  type ToolReport,
} from "../../domain/src/tool-detection.ts";

interface Row {
  id: string;
  origin: "detected" | "manual";
  label: string;
  path: string | null;
  enabled: number;
  is_default: number;
}

/** A person's choices about detected tools, and tools they added by hand. */
export class ToolRegistry {
  private readonly db: Database.Database;
  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Every tool Amun probes: the built-in list plus manual additions. */
  tools(): (KnownTool & { explicitPath?: string })[] {
    const manual = (
      this.db
        .prepare(
          "SELECT * FROM tool_registry WHERE origin='manual' ORDER BY label,id",
        )
        .all() as Row[]
    ).map((row) => ({
      id: row.id,
      label: row.label,
      command: row.id,
      versionArgs: ["--version"],
      access: "Added by you. Runs as a coding worker in the task's worktree.",
      dataShared: "Depends on the tool; check its own documentation.",
      signIn: "Sign in with the tool's own command",
      install: "Reinstall it or correct its path",
      lifecycleEvents: false,
      explicitPath: row.path!,
    }));
    return [...knownTools, ...manual];
  }

  /** Combines fresh probe results with stored choices. */
  report(probes: Readonly<Record<string, ProbeResult>>): ToolReport[] {
    return this.tools().map((tool) => {
      const row = this.row(tool.id);
      return classifyTool(tool, probes[tool.id] ?? { found: false }, {
        enabled: row ? row.enabled === 1 : true,
        isDefault: row?.is_default === 1,
        origin: row?.origin ?? "detected",
        ...(row?.path ? { path: row.path } : {}),
      });
    });
  }

  /** Adds a tool that detection did not find, by its absolute path. */
  addManual(id: string, label: string, path: string): void {
    if (
      !/^[a-z][a-z0-9_-]{0,31}$/.test(id) ||
      knownTools.some((t) => t.id === id)
    )
      throw Error("Choose a short, new name for the tool");
    if (!label.trim()) throw Error("Give the tool a display name");
    if (
      !path.startsWith("/") ||
      path.includes("\0") ||
      /\/\.\.?(\/|$)/.test(path)
    )
      throw Error("Give the tool's absolute path");
    this.db
      .prepare(
        "INSERT INTO tool_registry(id,origin,label,path,updated_at) VALUES (?,'manual',?,?,?)",
      )
      .run(id, label.trim(), path, new Date().toISOString());
  }

  setEnabled(id: string, enabled: boolean): void {
    this.ensure(id);
    this.db
      .prepare(
        "UPDATE tool_registry SET enabled=?, is_default=CASE WHEN ?=0 THEN 0 ELSE is_default END, updated_at=? WHERE id=?",
      )
      .run(enabled ? 1 : 0, enabled ? 1 : 0, new Date().toISOString(), id);
  }

  /** Makes one enabled tool the default worker; any earlier default is cleared. */
  setDefault(id: string): void {
    this.ensure(id);
    if (this.row(id)!.enabled !== 1)
      throw Error("Turn the tool on before making it the default");
    this.db.transaction(() => {
      this.db.prepare("UPDATE tool_registry SET is_default=0").run();
      this.db
        .prepare(
          "UPDATE tool_registry SET is_default=1, updated_at=? WHERE id=?",
        )
        .run(new Date().toISOString(), id);
    })();
  }

  /** Removes a manual tool, or forgets the choices made for a detected one. */
  remove(id: string): void {
    this.db.prepare("DELETE FROM tool_registry WHERE id=?").run(id);
  }

  private ensure(id: string): void {
    if (this.row(id)) return;
    const tool = knownTools.find((candidate) => candidate.id === id);
    if (!tool) throw Error("Unknown tool");
    this.db
      .prepare(
        "INSERT INTO tool_registry(id,origin,label,updated_at) VALUES (?,'detected',?,?)",
      )
      .run(id, tool.label, new Date().toISOString());
  }

  private row(id: string): Row | undefined {
    return this.db.prepare("SELECT * FROM tool_registry WHERE id=?").get(id) as
      Row | undefined;
  }
}
