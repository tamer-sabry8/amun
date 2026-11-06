import { it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { migrate } from "../src/database.ts";
import { ActionStore, dispatchOne } from "../src/outbox.ts";
import { NotionOutboxConnector } from "../src/notion-publication.ts";
import { NotionPublisher } from "../../connectors-notion/src/client.ts";
const parentId = "11111111-1111-4111-8111-111111111111",
  pageId = "22222222-2222-4222-8222-222222222222";
function setup() {
  const db = new Database(":memory:");
  migrate(db);
  db.prepare(
    "INSERT INTO products(id,name,created_at) VALUES ('p','Product','now')",
  ).run();
  return { db, store: new ActionStore(db) };
}
const payload = {
  parentId,
  title: "Reviewed",
  text: "Safe selected conversation",
  contentHash: createHash("sha256")
    .update(JSON.stringify(["Reviewed", "Safe selected conversation"]))
    .digest("hex"),
};
const draft = {
  id: "notion-action",
  productId: "p",
  kind: "notion_publish" as const,
  payload,
  revisions: {},
  requestedBy: "user",
  operationMarker: "notion-marker",
};
it("publishes only after bound approval and persists the created page receipt", async () => {
  const { db, store } = setup();
  try {
    const send = vi.fn(async () => ({
      status: 200,
      data: {
        object: "page",
        id: pageId,
        parent: { type: "page_id", page_id: parentId },
      },
    }));
    const connector = new NotionOutboxConnector(db, new NotionPublisher(send));
    store.propose(draft);
    expect(await dispatchOne(store, connector)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    store.approve(draft.id, "user");
    await dispatchOne(store, connector);
    expect(store.read(draft.id).state).toBe("succeeded");
    expect(connector.receipt(draft.operationMarker)).toEqual({
      pageId,
      parentId,
      contentHash: payload.contentHash,
    });
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    db.close();
  }
});
it("never retries a write with an uncertain result, including after service recovery", async () => {
  const { db, store } = setup();
  try {
    const send = vi.fn(async () => {
      throw Error("lost after commit");
    });
    const connector = new NotionOutboxConnector(db, new NotionPublisher(send));
    store.propose(draft);
    store.approve(draft.id, "user");
    await dispatchOne(store, connector);
    store.recover();
    await dispatchOne(store, connector);
    expect(store.read(draft.id).state).toBe("unknown");
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    db.close();
  }
});
it("recovers a persisted receipt after interruption without repeating creation", async () => {
  const { db, store } = setup();
  try {
    const send = vi.fn(async () => ({
      status: 200,
      data: {
        object: "page",
        id: pageId,
        parent: { type: "page_id", page_id: parentId },
      },
    }));
    const connector = new NotionOutboxConnector(db, new NotionPublisher(send));
    store.propose(draft);
    store.approve(draft.id, "user");
    const claimed = store.claim("notion_publish")!;
    await connector.execute(claimed);
    store.recover();
    await dispatchOne(
      store,
      new NotionOutboxConnector(db, new NotionPublisher(send)),
    );
    expect(store.read(draft.id).state).toBe("succeeded");
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    db.close();
  }
});
it("refuses changed content hashes or a non-executing action before transport", async () => {
  const { db, store } = setup();
  try {
    const send = vi.fn();
    const connector = new NotionOutboxConnector(db, new NotionPublisher(send));
    store.propose(draft);
    await expect(connector.execute(store.read(draft.id))).rejects.toThrow();
    store.approve(draft.id, "user");
    const action = store.claim("notion_publish")!;
    await expect(
      connector.execute({
        ...action,
        payload: { ...payload, text: "Changed" },
      }),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});
it("does not treat corrupted or mismatched receipts as proof of publication", async () => {
  const { db, store } = setup();
  try {
    const send = vi.fn(async () => ({
      status: 200,
      data: {
        object: "page",
        id: pageId,
        parent: { type: "page_id", page_id: parentId },
      },
    }));
    const connector = new NotionOutboxConnector(db, new NotionPublisher(send));
    store.propose(draft);
    store.approve(draft.id, "user");
    const action = store.claim("notion_publish")!;
    await connector.execute(action);
    await expect(connector.execute(action)).rejects.toThrow("receipt");
    expect(send).toHaveBeenCalledTimes(1);
    for (const value of [
      { pageId: "bad", parentId, contentHash: payload.contentHash },
      { pageId, parentId: pageId, contentHash: payload.contentHash },
      { pageId, parentId, contentHash: "b".repeat(64) },
      null,
    ]) {
      db.prepare("UPDATE workspace_settings SET value_json=?").run(
        JSON.stringify(value),
      );
      expect(connector.receipt(draft.operationMarker)).toBeUndefined();
      expect(await connector.reconcile(draft.operationMarker)).toEqual({
        state: "unknown",
      });
    }
  } finally {
    db.close();
  }
});
it("rejects invalid stored publication payloads even if the generic outbox approved them", async () => {
  for (const invalid of [
    null,
    {},
    { ...payload, parentId: "bad" },
    { ...payload, contentHash: "bad" },
  ]) {
    const { db, store } = setup();
    try {
      const send = vi.fn();
      const connector = new NotionOutboxConnector(
        db,
        new NotionPublisher(send),
      );
      store.propose({ ...draft, payload: invalid });
      store.approve(draft.id, "user");
      await expect(
        connector.execute(store.claim("notion_publish")!),
      ).rejects.toThrow();
      expect(send).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  }
});
it("binds database parent type and title property into the durable receipt", async () => {
  const { db, store } = setup();
  try {
    const send = vi.fn(async () => ({
      status: 200,
      data: {
        object: "page",
        id: pageId,
        parent: { type: "data_source_id", data_source_id: parentId },
      },
    }));
    const connector = new NotionOutboxConnector(db, new NotionPublisher(send));
    const databasePayload = {
      ...payload,
      parentType: "data_source_id" as const,
      titleProperty: "Doc name",
    };
    store.propose({ ...draft, payload: databasePayload });
    store.approve(draft.id, "user");
    await dispatchOne(store, connector);
    expect(store.read(draft.id).state).toBe("succeeded");
    expect(connector.receipt(draft.operationMarker)).toEqual({
      pageId,
      parentId,
      contentHash: payload.contentHash,
      parentType: "data_source_id",
      titleProperty: "Doc name",
    });
    db.prepare("UPDATE workspace_settings SET value_json=?").run(
      JSON.stringify({
        pageId,
        parentId,
        contentHash: payload.contentHash,
        parentType: "page_id",
        titleProperty: "Doc name",
      }),
    );
    expect(connector.receipt(draft.operationMarker)).toBeUndefined();
  } finally {
    db.close();
  }
});
