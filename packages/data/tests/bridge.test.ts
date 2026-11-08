import { ActionStore } from "../src/outbox.ts";
import { WorkspaceService } from "../src/workspace-service.ts";
import Database from "better-sqlite3";
import { it, expect } from "vitest";
import { migrate } from "../src/database.ts";
import { handleBridgeRequest } from "../src/pi-bridge.ts";
import { Redactor } from "../../security/src/redaction.ts";
it("persists blocked calls under the host product and records decision requests without approving or executing", () => {
  const db = new Database(":memory:");
  migrate(db);
  db.prepare(
    "INSERT INTO products(id,name,created_at) VALUES ('p','Product','now')",
  ).run();
  const handle = handleBridgeRequest(db, "p", new Redactor());
  const id = handle({
    op: "gate",
    name: "mcp_write",
    nested: true,
    digest: "a".repeat(64),
  });
  expect(
    db
      .prepare("SELECT state,product_id,requested_by FROM actions WHERE id=?")
      .get(id),
  ).toEqual({
    state: "pending_approval",
    product_id: "p",
    requested_by: "firstmate",
  });
  handle({ op: "tool", name: "amun_report_blocker", summary: "Need an owner" });
  expect(
    db.prepare("SELECT type FROM attention_items WHERE governed=0").get(),
  ).toEqual({
    type: "unblock",
  });
  expect(db.prepare("SELECT COUNT(*) n FROM approvals").get()).toEqual({
    n: 0,
  });
  expect(() =>
    handleBridgeRequest(
      db,
      null,
      new Redactor(),
    )({ op: "tool", name: "amun_request_merge", summary: "test" }),
  ).toThrow();
  handle({ op: "event", name: "mcp_replaced" });
  const snapshot = new WorkspaceService(db).snapshot();
  expect(snapshot.notifications[0]?.kind).toBe("failure");
  expect(
    db.prepare("SELECT governed FROM attention_items WHERE id=?").get(id),
  ).toEqual({ governed: 1 });
  const store = new ActionStore(db);
  store.approve(id, "owner");
  expect(store.claim()).toBeUndefined();
  db.close();
});
