import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, schemaVersion, migrationChecksums } from "../src/database.ts";
it("upgrades every prior schema with preserved seed data and transactional migrations", () => {
  for (let version = 0; version <= schemaVersion; version++) {
    const root = mkdtempSync(join(tmpdir(), "amun-db-"));
    const file = join(root, "workspace.sqlite");
    try {
      let db = new Database(file);
      migrate(db, version);
      if (version > 0)
        db.prepare(
          "INSERT INTO products(id,name,created_at) VALUES (?,?,?)",
        ).run("p1", "Preserve me", "2026-11-06T00:00:00Z");
      db.close();
      db = new Database(file);
      migrate(db);
      expect(db.pragma("user_version", { simple: true })).toBe(schemaVersion);
      if (version > 0)
        expect(
          db.prepare("SELECT name FROM products WHERE id=?").get("p1"),
        ).toEqual({ name: "Preserve me" });
      expect(() =>
        db
          .prepare("SELECT rowid FROM search_index WHERE search_index MATCH ?")
          .all("test"),
      ).not.toThrow();
      migrate(db);
      expect(
        db.prepare("SELECT count(*) as n FROM schema_migrations").get(),
      ).toEqual({ n: schemaVersion });
      db.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
it("refuses future versions, corrupt migration history and downgrade requests", () => {
  const db = new Database(":memory:");
  migrate(db);
  expect(migrationChecksums).toHaveLength(schemaVersion);
  expect(() => migrate(db, 0)).toThrow();
  db.prepare("UPDATE schema_migrations SET checksum=? WHERE version=1").run(
    "tampered",
  );
  expect(() => migrate(db)).toThrow();
  db.close();
  const future = new Database(":memory:");
  future.pragma("user_version=999");
  expect(() => migrate(future)).toThrow();
  future.close();
});
it("enforces foreign keys, unique operation markers and searchable product-scoped text", () => {
  const db = new Database(":memory:");
  migrate(db);
  db.prepare("INSERT INTO products(id,name,created_at) VALUES (?,?,?)").run(
    "p",
    "Product",
    "now",
  );
  expect(() =>
    db
      .prepare(
        "INSERT INTO objectives(id,product_id,statement,status) VALUES (?,?,?,?)",
      )
      .run("o", "missing", "text", "draft"),
  ).toThrow();
  db.prepare(
    "INSERT INTO search_index(product_id,entity_id,kind,title,body) VALUES (?,?,?,?,?)",
  ).run("p", "o", "objective", "Search me", "Firstmate durable core");
  expect(
    db
      .prepare(
        "SELECT entity_id FROM search_index WHERE search_index MATCH ? AND product_id=?",
      )
      .all("durable", "p"),
  ).toEqual([{ entity_id: "o" }]);
  expect(
    db
      .prepare(
        "SELECT entity_id FROM search_index WHERE search_index MATCH ? AND product_id=?",
      )
      .all("durable", "other"),
  ).toEqual([]);
  db.close();
});

it("rolls back the entire upgrade when a later migration fails", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE search_index (conflict TEXT)");
  expect(() => migrate(db)).toThrow();
  expect(db.pragma("user_version", { simple: true })).toBe(0);
  expect(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name IN ('products','schema_migrations')",
      )
      .all(),
  ).toEqual([]);
  db.close();
});

it("rejects invalid targets, incomplete ledgers and nested migration transactions", () => {
  for (const target of [-1, 0.1, NaN, Infinity, 999]) {
    const db = new Database(":memory:");
    expect(() => migrate(db, target)).toThrow();
    db.close();
  }
  const missing = new Database(":memory:");
  missing.pragma("user_version=1");
  expect(() => migrate(missing)).toThrow(/history/);
  missing.close();
  const db = new Database(":memory:");
  migrate(db);
  expect(() => db.transaction(() => migrate(db))()).toThrow(/own transaction/);
  db.prepare("DELETE FROM schema_migrations WHERE version=1").run();
  expect(() => migrate(db)).toThrow(/history/);
  db.close();
});

it("matches all declared Drizzle columns to the migrated database", async () => {
  const { getTableConfig } = await import("drizzle-orm/sqlite-core");
  const schema = await import("../src/schema.ts");
  const db = new Database(":memory:");
  migrate(db);
  for (const table of Object.values(schema)) {
    const config = getTableConfig(table);
    const columns = db.prepare(`PRAGMA table_info("${config.name}")`).all() as {
      name: string;
    }[];
    expect(columns.map((column) => column.name)).toEqual(
      config.columns.map((column) => column.name),
    );
  }
  db.close();
});

it("rejects invalid JSON, duplicate operations and orphan approvals", () => {
  const db = new Database(":memory:");
  migrate(db);
  expect(() =>
    db
      .prepare(
        "INSERT INTO products(id,name,allowed_models_json,created_at) VALUES (?,?,?,?)",
      )
      .run("p", "Product", "not json", "now"),
  ).toThrow();
  db.prepare("INSERT INTO products(id,name,created_at) VALUES (?,?,?)").run(
    "p",
    "Product",
    "now",
  );
  const action = db.prepare(
    "INSERT INTO actions(id,product_id,kind,payload_hash,state,requested_by,operation_marker) VALUES (?,?,?,?,?,?,?)",
  );
  action.run("a", "p", "publish", "hash", "proposed", "pm", "operation");
  expect(() =>
    action.run("b", "p", "publish", "hash", "proposed", "pm", "operation"),
  ).toThrow();
  expect(() =>
    db
      .prepare(
        "INSERT INTO approvals(id,decision,kind,payload_hash,approved_by,approved_at) VALUES (?,?,?,?,?,?)",
      )
      .run("approval", "approve", "publish", "hash", "pm", "now"),
  ).toThrow();
  db.close();
});
