import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { migrations } from "./migrations.ts";

export const schemaVersion = migrations.length;
export const migrationChecksums = Object.freeze(
  migrations.map((sql) => createHash("sha256").update(sql).digest("hex")),
);

/** Service-owned connection. All schema changes and the ledger commit together. */
export function migrate(
  db: Database.Database,
  target: number = schemaVersion,
): void {
  if (!Number.isSafeInteger(target) || target < 0 || target > schemaVersion)
    throw new Error("Unsupported migration target");
  if (db.inTransaction)
    throw new Error("Migration requires its own transaction");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  // SQLite table rebuilds require foreign_keys off outside the transaction.
  // Validate every reference before commit, and always restore enforcement.
  const installed = db.pragma("user_version", { simple: true }) as number;
  const rebuildingActions = migrations
    .slice(installed, target)
    .some((sql) => sql.includes("DROP TABLE actions;"));
  if (rebuildingActions) db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      const current = db.pragma("user_version", { simple: true }) as number;
      if (current > schemaVersion || current < 0)
        throw new Error("Unsupported database version");
      if (target < current) throw new Error("Database downgrade refused");
      const exists = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
        )
        .get();
      if (!exists && current !== 0)
        throw new Error("Missing migration history");
      db.exec(
        "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)",
      );
      const history = db
        .prepare(
          "SELECT version,checksum FROM schema_migrations ORDER BY version",
        )
        .all() as { version: number; checksum: string }[];
      if (
        history.length !== current ||
        history.some(
          (row, index) =>
            row.version !== index + 1 ||
            row.checksum !== migrationChecksums[index],
        )
      )
        throw new Error("Corrupt migration history");
      for (let index = current; index < target; index++) {
        db.exec(migrations[index]!);
        db.prepare(
          "INSERT INTO schema_migrations(version,checksum) VALUES (?,?)",
        ).run(index + 1, migrationChecksums[index]!);
        db.pragma(`user_version = ${index + 1}`);
      }
      if ((db.pragma("foreign_key_check") as unknown[]).length)
        throw Error("Invalid database references");
    }).immediate();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}
