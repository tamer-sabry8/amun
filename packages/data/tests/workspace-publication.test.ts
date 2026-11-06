import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { ActionStore } from "../src/outbox.ts";
const draft = {
  id: "workspace-share",
  productId: null,
  kind: "notion_publish" as const,
  payload: { text: "reviewed" },
  revisions: {},
  requestedBy: "user",
  operationMarker: "workspace-share",
};
it("supports workspace conversation approval without manufacturing a product", () => {
  const db = new Database(":memory:");
  try {
    migrate(db);
    const store = new ActionStore(db);
    store.propose(draft);
    expect(db.prepare("SELECT count(*) n FROM products").get()).toEqual({
      n: 0,
    });
    expect(store.claim("notion_publish")).toBeUndefined();
    store.approve(draft.id, "user");
    expect(store.claim("notion_publish")?.id).toBe(draft.id);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  } finally {
    db.close();
  }
});
it("rejects unscoped product actions and invalid workspace scopes", () => {
  const db = new Database(":memory:");
  try {
    migrate(db);
    const store = new ActionStore(db);
    expect(() => store.propose({ ...draft, kind: "merge" })).toThrow();
    expect(() => store.propose({ ...draft, productId: "" })).toThrow();
    expect(() => store.propose({ ...draft, productId: "missing" })).toThrow();
    expect(db.prepare("SELECT count(*) n FROM actions").get()).toEqual({
      n: 0,
    });
  } finally {
    db.close();
  }
});
it("upgrades existing approved actions without losing approvals, outbox or foreign keys", () => {
  const db = new Database(":memory:");
  try {
    migrate(db, 3);
    db.prepare(
      "INSERT INTO products(id,name,created_at) VALUES ('p','Existing','now')",
    ).run();
    const store = new ActionStore(db);
    store.propose({ ...draft, productId: "p" });
    store.approve(draft.id, "user");
    migrate(db);
    expect(store.claim("notion_publish")?.id).toBe(draft.id);
    expect(db.prepare("SELECT count(*) n FROM approvals").get()).toEqual({
      n: 1,
    });
    expect(db.pragma("foreign_key_check")).toEqual([]);
  } finally {
    db.close();
  }
});

it("refuses a migration with orphaned records and restores foreign-key enforcement", () => {
  const db = new Database(":memory:");
  try {
    migrate(db, 3);
    db.pragma("foreign_keys = OFF");
    db.prepare(
      "INSERT INTO outbox(id,action_id,step,attempt,state) VALUES ('orphan','missing','execute',0,'waiting')",
    ).run();
    expect(() => migrate(db)).toThrow();
    expect(db.pragma("user_version", { simple: true })).toBe(3);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  } finally {
    db.close();
  }
});
