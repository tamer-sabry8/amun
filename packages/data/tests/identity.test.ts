import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { workspaceIdentity } from "../src/identity.ts";
it("persists one stable identity per workspace and isolates distinct workspaces", () => {
  const first = new Database(":memory:");
  const second = new Database(":memory:");
  migrate(first);
  migrate(second);
  const id = workspaceIdentity(first);
  expect(workspaceIdentity(first)).toBe(id);
  expect(workspaceIdentity(second)).not.toBe(id);
  expect(id).toMatch(/^[a-f0-9-]{36}$/);
  first.close();
  second.close();
});
it("refuses corrupt identities instead of adopting another credential namespace", () => {
  const db = new Database(":memory:");
  migrate(db);
  db.prepare("INSERT INTO workspace_settings(id,value_json) VALUES (?,?)").run(
    "workspace_identity",
    '"../personal"',
  );
  expect(() => workspaceIdentity(db)).toThrow();
  db.close();
});
