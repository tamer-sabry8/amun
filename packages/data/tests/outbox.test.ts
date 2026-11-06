import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { ActionStore, dispatchOne } from "../src/outbox.ts";
function setup() {
  const db = new Database(":memory:");
  migrate(db);
  db.prepare("INSERT INTO products(id,name,created_at) VALUES (?,?,?)").run(
    "p",
    "Product",
    "now",
  );
  return { db, store: new ActionStore(db) };
}
const draft = {
  id: "action",
  productId: "p",
  kind: "publish" as const,
  payload: { title: "Test" },
  revisions: { rev: 1 },
  requestedBy: "pm",
  operationMarker: "unique-operation",
};
it("commits action and outbox atomically; duplicate marker and invalid input cannot leave partial records", () => {
  const { db, store } = setup();
  store.propose(draft);
  expect(store.read("action").state).toBe("pending_approval");
  expect(db.prepare("SELECT state FROM outbox").get()).toEqual({
    state: "waiting",
  });
  expect(() => store.propose({ ...draft, id: "other" })).toThrow();
  expect(db.prepare("SELECT count(*) n FROM actions").get()).toEqual({ n: 1 });
  db.exec(
    "CREATE TRIGGER reject_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'injected failure'); END",
  );
  expect(() =>
    store.propose({ ...draft, id: "new", operationMarker: "new" }),
  ).toThrow();
  expect(() => store.read("new")).toThrow();
  db.close();
});
it("persists approval binding, invalidates edited actions and refuses stale/tampered approval", () => {
  const { db, store } = setup();
  store.propose(draft);
  store.approve("action", "pm");
  store.edit("action", { title: "Changed" }, { rev: 1 });
  expect(store.read("action").state).toBe("invalidated");
  expect(store.claim()).toBeUndefined();
  expect(db.prepare("SELECT invalidated_reason FROM approvals").get()).toEqual({
    invalidated_reason: "Action binding changed",
  });
  store.requestApproval("action");
  store.approve("action", "pm");
  db.prepare("UPDATE actions SET target_revisions_json=? WHERE id=?").run(
    '{"rev":2}',
    "action",
  );
  expect(store.claim()).toBeUndefined();
  expect(store.read("action").state).toBe("invalidated");
  db.close();
});
it("executes only approved work and never automatically repeats an uncertain write", async () => {
  const { db, store } = setup();
  store.propose(draft);
  let writes = 0;
  let reconciles = 0;
  const connector = {
    kind: "publish" as const,
    execute: async () => {
      writes++;
      throw Error("disconnected after write");
    },
    reconcile: async (marker: string) => {
      expect(marker).toBe(draft.operationMarker);
      reconciles++;
      return { state: "found" as const };
    },
  };
  expect(await dispatchOne(store, connector)).toBe(false);
  store.approve("action", "pm");
  await dispatchOne(store, connector);
  expect(store.read("action").state).toBe("unknown");
  await dispatchOne(store, connector);
  expect(store.read("action").state).toBe("succeeded");
  expect(writes).toBe(1);
  expect(reconciles).toBe(1);
  expect(await dispatchOne(store, connector)).toBe(false);
  db.close();
});
it("recovers executing rows as unknown and handles inconclusive/absent reconciliation without writes", async () => {
  const { db, store } = setup();
  store.propose(draft);
  store.approve("action", "pm");
  expect(store.claim()?.id).toBe("action");
  expect(store.claim()).toBeUndefined();
  store.recover();
  expect(store.read("action").state).toBe("unknown");
  let writes = 0;
  await dispatchOne(store, {
    kind: "publish",
    execute: async () => {
      writes++;
    },
    reconcile: async () => ({ state: "unknown" }),
  });
  expect(store.read("action").state).toBe("unknown");
  await dispatchOne(store, {
    kind: "publish",
    execute: async () => {
      writes++;
    },
    reconcile: async () => ({ state: "absent" }),
  });
  expect(store.read("action").state).toBe("failed");
  expect(writes).toBe(0);
  db.close();
});

it("does not route an action to a connector registered for another approval kind", async () => {
  const { db, store } = setup();
  store.propose(draft);
  store.approve("action", "pm");
  let writes = 0;
  expect(
    await dispatchOne(store, {
      kind: "merge",
      execute: async () => {
        writes++;
      },
      reconcile: async () => ({ state: "found" }),
    }),
  ).toBe(false);
  expect(writes).toBe(0);
  expect(store.read("action").state).toBe("approved");
  db.close();
});
