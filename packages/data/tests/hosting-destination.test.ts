import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { readHosting, saveHosting } from "../src/hosting-destination.ts";
function database() {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE workspace_settings(id TEXT PRIMARY KEY,value_json TEXT)",
  );
  return db;
}
it("keeps hosting unselected until the owner chooses a destination in that workspace", () => {
  const a = database(),
    b = database();
  expect(readHosting(a)).toBeNull();
  const target = {
    provider: "cloudflare",
    zone: "example.org",
    host: "site.example.org",
  };
  saveHosting(a, target);
  expect(readHosting(a)).toEqual(target);
  expect(readHosting(b)).toBeNull();
  expect(() =>
    saveHosting(a, { ...target, host: "example.org.attacker.test" }),
  ).toThrow();
  expect(readHosting(a)).toEqual(target);
  saveHosting(a, { provider: "other", host: "my.example.net" });
  expect(readHosting(a)?.provider).toBe("other");
  a.close();
  b.close();
});
