import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
export function workspaceIdentity(db: Database.Database): string {
  return db
    .transaction(() => {
      const row = db
        .prepare(
          "SELECT value_json FROM workspace_settings WHERE id='workspace_identity'",
        )
        .get() as { value_json: string } | undefined;
      if (row) {
        const value: unknown = JSON.parse(row.value_json);
        if (
          typeof value !== "string" ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
            value,
          )
        )
          throw Error("Invalid workspace identity");
        return value;
      }
      const value = randomUUID();
      db.prepare(
        "INSERT INTO workspace_settings(id,value_json) VALUES ('workspace_identity',?)",
      ).run(JSON.stringify(value));
      return value;
    })
    .immediate();
}
