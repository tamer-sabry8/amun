import { it, expect } from "vitest";
import Database from "better-sqlite3";
import {
  mkdtempSync,
  mkdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
  linkSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openWorkspace } from "../src/workspace.ts";
it("opens a private WAL database and preserves data across service connection restarts", () => {
  const root = mkdtempSync(join(tmpdir(), "amun-workspace-"));
  try {
    const dir = join(root, "workspace");
    let db = openWorkspace(dir, Database);
    db.prepare("INSERT INTO products(id,name,created_at) VALUES (?,?,?)").run(
      "p",
      "Persisted",
      "now",
    );
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "workspace.sqlite")).mode & 0o777).toBe(0o600);
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    db.close();
    db = openWorkspace(dir, Database);
    expect(db.prepare("SELECT name FROM products").get()).toEqual({
      name: "Persisted",
    });
    db.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("refuses unsafe directories, database links, loose modes and WAL links without modifying them", () => {
  const root = mkdtempSync(join(tmpdir(), "amun-workspace-"));
  try {
    const actual = join(root, "actual");
    mkdirSync(actual, { mode: 0o700 });
    const linked = join(root, "linked");
    symlinkSync(actual, linked);
    expect(() => openWorkspace(linked, Database)).toThrow();
    chmodSync(actual, 0o755);
    expect(() => openWorkspace(actual, Database)).toThrow();
    chmodSync(actual, 0o700);
    const outside = join(root, "outside");
    writeFileSync(outside, "keep", { mode: 0o600 });
    const file = join(actual, "workspace.sqlite");
    symlinkSync(outside, file);
    expect(() => openWorkspace(actual, Database)).toThrow();
    rmSync(file);
    linkSync(outside, file);
    expect(() => openWorkspace(actual, Database)).toThrow();
    rmSync(file);
    symlinkSync(outside, file + "-wal");
    expect(() => openWorkspace(actual, Database)).toThrow();
    expect(statSync(outside).size).toBe(4);
    expect(() => openWorkspace("relative", Database)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
