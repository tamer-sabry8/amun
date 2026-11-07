import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { AttentionStore, searchEntities } from "../src/attention-store.ts";
import type { AttentionItem } from "../../contracts/src/entities.ts";
const item: AttentionItem = {
  id: "q",
  productId: "p",
  type: "answer",
  origin: {
    kind: "secondmate",
    label: "Secondmate · Research",
    firstmateRef: "task",
  },
  ask: "Which customer segment?",
  detail: "Needs an answer",
  blocking: [],
  primaryAction: {
    label: "Answer",
    mode: "inline",
    intent: "answer",
    targetRef: "q",
  },
  governed: false,
  state: "open",
  snoozedUntil: null,
  createdAt: "2026-11-06T00:00:00Z",
};
it("persists shared Requests/Island state and only explicit resolution/snooze changes visibility", () => {
  const db = new Database(":memory:");
  migrate(db);
  db.prepare("INSERT INTO products(id,name,created_at) VALUES (?,?,?)").run(
    "p",
    "Product",
    "now",
  );
  const store = new AttentionStore(db);
  store.create(item);
  expect(store.list("p")).toEqual([item]);
  expect(store.list("other")).toEqual([]);
  store.snooze("q", Date.now() + 60000);
  expect(store.list("p")[0]?.state).toBe("snoozed");
  store.wake(Date.now() + 120000);
  expect(store.list("p")[0]?.state).toBe("open");
  store.resolve("q", "island", "Enterprise customers");
  expect(store.list("p")[0]?.state).toBe("resolved");
  expect(db.prepare("SELECT chosen FROM decisions").get()).toEqual({
    chosen: "Enterprise customers",
  });
  expect(
    db.prepare("SELECT resolved_by FROM attention_items WHERE id=?").get("q"),
  ).toEqual({ resolved_by: "pm" });
  db.close();
});
it("indexes persisted entities for scoped command-palette search without accepting FTS syntax injection", () => {
  const db = new Database(":memory:");
  migrate(db);
  db.prepare("INSERT INTO products(id,name,created_at) VALUES (?,?,?)").run(
    "p",
    "Product",
    "now",
  );
  new AttentionStore(db).create(item);
  expect(searchEntities(db, "p", "customer").map((row) => row.id)).toEqual([
    "q",
  ]);
  expect(searchEntities(db, "other", "customer")).toEqual([]);
  expect(() => searchEntities(db, "p", '" OR * NOT')).not.toThrow();
  expect(searchEntities(db, "p", "")).toEqual([]);
  db.prepare("UPDATE attention_items SET ask=? WHERE id=?").run(
    "Which audience?",
    "q",
  );
  expect(searchEntities(db, "p", "customer")).toEqual([]);
  expect(searchEntities(db, "p", "audience").map((row) => row.id)).toEqual([
    "q",
  ]);
  db.close();
});
