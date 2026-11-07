import type Database from "better-sqlite3";
import { hostingDestination } from "../../contracts/src/hosting.ts";
export function readHosting(db: Database.Database) {
  const row = db
    .prepare(
      "SELECT value_json FROM workspace_settings WHERE id='hosting.destination'",
    )
    .get() as { value_json: string } | undefined;
  return row ? hostingDestination.parse(JSON.parse(row.value_json)) : null;
}
export function saveHosting(db: Database.Database, input: unknown) {
  const target = hostingDestination.parse(input);
  db.prepare(
    "INSERT INTO workspace_settings(id,value_json) VALUES ('hosting.destination',?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json",
  ).run(JSON.stringify(target));
  return target;
}
