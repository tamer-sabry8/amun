import { ActionStore } from "../src/outbox.ts";
import { it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { NotionConversationReview } from "../src/notion-review.ts";
const target = {
  title: "Documents",
  parentId: "11111111-1111-4111-8111-111111111111",
  parentType: "data_source_id" as const,
  titleProperty: "Doc name",
};
it("requires the exact reviewed binding and executes only the selected conversation once", async () => {
  const db = new Database(":memory:");
  migrate(db);
  const create = vi.fn(async (_input: unknown) => {
    void _input;
    return {
      state: "created" as const,
      pageId: "22222222-2222-4222-8222-222222222222",
    };
  });
  try {
    const reviews = new NotionConversationReview(db, { create });
    const first = reviews.prepare(
      { title: "First", text: "First exact text" },
      target,
      "workspace-id",
    );
    const selected = reviews.prepare(
      { title: "Second", text: "Second exact text" },
      target,
      "workspace-id",
    );
    expect(create).not.toHaveBeenCalled();
    await expect(reviews.publish(selected.id, first.binding)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
    expect(await reviews.publish(selected.id, selected.binding)).toBe(
      "succeeded",
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toMatchObject({
      title: "Second",
      text: selected.text,
      parentId: target.parentId,
    });
    await expect(
      reviews.publish(selected.id, selected.binding),
    ).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
  } finally {
    db.close();
  }
});
it("keeps an uncertain result unknown and never repeats it after a lost response", async () => {
  const db = new Database(":memory:");
  migrate(db);
  const create = vi.fn(async () => ({ state: "unknown" as const }));
  try {
    const reviews = new NotionConversationReview(db, { create });
    const item = reviews.prepare(
      { title: "Test", text: "Reviewed" },
      target,
      "workspace-id",
    );
    expect(await reviews.publish(item.id, item.binding)).toBe("unknown");
    await expect(reviews.publish(item.id, item.binding)).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
    expect(reviews.unconfirmed()).toEqual([{ id: item.id, title: "Test" }]);
    expect(reviews.receipts()).toEqual([]);
  } finally {
    db.close();
  }
});

it("restores only verified publication receipts without executing another write", async () => {
  const db = new Database(":memory:");
  migrate(db);
  const create = vi.fn(async () => ({
    state: "created" as const,
    pageId: "22222222-2222-4222-8222-222222222222",
  }));
  try {
    const reviews = new NotionConversationReview(db, { create });
    const item = reviews.prepare(
      { title: "Published fixture", text: "Exact reviewed content" },
      target,
      "workspace-id",
    );
    expect(reviews.receipts()).toEqual([]);
    await reviews.publish(item.id, item.binding);
    expect(new NotionConversationReview(db, { create }).receipts()).toEqual([
      {
        id: item.id,
        title: "Published fixture",
        url: "https://www.notion.so/22222222222242228222222222222222",
      },
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    db.prepare(
      "UPDATE workspace_settings SET value_json='{}' WHERE id LIKE 'notion.receipt.%'",
    ).run();
    expect(reviews.receipts()).toEqual([]);
    expect(create).toHaveBeenCalledTimes(1);
  } finally {
    db.close();
  }
});

it("binds the visible ID before sending and recovers a lost create reply with one create", async () => {
  const db = new Database(":memory:");
  migrate(db);
  try {
    const create = vi.fn(async () => ({ state: "unknown" as const }));
    const reviews = new NotionConversationReview(db, { create });
    const review = reviews.prepare(
      { title: "Repeat", text: "Approved" },
      target,
      "workspace",
    );
    expect(review.text).toBe("Approved\n\nAmun publication ID: " + review.id);
    expect(reviews.deliveryState(review.id)).toBe("not sent");
    await reviews.publish(review.id, review.binding);
    expect(create.mock.calls).toHaveLength(1);
    expect(reviews.deliveryState(review.id)).toBe("sent-unknown");
    const reopened = new NotionConversationReview(db, { create });
    expect(
      await reopened.check(review.id, async () => {
        throw Error("offline");
      }),
    ).toBe("blocked");
    const check = vi.fn(async () => "22222222-2222-4222-8222-222222222222");
    expect(await reopened.check(review.id, check)).toBe("wait");
    expect(check).not.toHaveBeenCalled();
    expect(
      await reopened.check(
        review.id,
        check,
        "https://www.notion.so/22222222222242228222222222222222",
      ),
    ).toBe("confirmed");
    expect(reopened.deliveryState(review.id)).toBe("confirmed");
    expect(reopened.receipts()).toHaveLength(1);
    await expect(reopened.publish(review.id, review.binding)).rejects.toThrow();
    expect(create.mock.calls).toHaveLength(1);
  } finally {
    db.close();
  }
});
it("distinguishes offline preflight from disconnection during send and preserves property-based review", async () => {
  const db = new Database(":memory:");
  migrate(db);
  try {
    let send = false;
    const reviews = new NotionConversationReview(db, {
      marksSendBoundary: true,
      create: async (_input, context) => {
        if (send) context.beforeSend();
        throw Error("Offline");
      },
    });
    for (const mode of [false, true]) {
      send = mode;
      const review = reviews.prepare(
        { title: "Test", text: "Approved" },
        { ...target, markerPropertyAvailable: true },
        "workspace",
      );
      expect(review.markerPropertyId).toBe(review.id);
      expect(review.text).toBe("Approved");
      await reviews.publish(review.id, review.binding);
      expect(reviews.deliveryState(review.id)).toBe(
        send ? "sent-unknown" : "not sent",
      );
    }
  } finally {
    db.close();
  }
});

it("refuses a payload changed after the preview check but before durable approval", async () => {
  const db = new Database(":memory:");
  migrate(db);
  const create = vi.fn(async () => ({ state: "unknown" as const }));
  const reviews = new NotionConversationReview(db, { create });
  const item = reviews.prepare(
    { title: "Original", text: "Reviewed" },
    target,
    "workspace",
  );
  const store = new ActionStore(db);
  const original = ActionStore.prototype.approve;
  const interleave = vi
    .spyOn(ActionStore.prototype, "approve")
    .mockImplementationOnce(function (this: ActionStore, ...args) {
      const current = store.read(item.id);
      store.edit(
        item.id,
        { ...(current.payload as object), title: "Changed" },
        current.revisions,
      );
      return original.apply(this, args);
    });
  try {
    await expect(reviews.publish(item.id, item.binding)).rejects.toThrow(
      /review/i,
    );
    expect(create).not.toHaveBeenCalled();
    expect(db.prepare("SELECT count(*) FROM approvals").pluck().get()).toBe(0);
  } finally {
    interleave.mockRestore();
    db.close();
  }
});

it("resumes the same pending review after restart and rejects destination or workspace drift", () => {
  const db = new Database(":memory:");
  migrate(db);
  const publisher = {
    create: vi.fn(async () => ({ state: "unknown" as const })),
  };
  try {
    const prepared = new NotionConversationReview(db, publisher).prepare(
      { title: "Saved update", text: "Exact body" },
      target,
      "workspace-id",
    );
    const resumed = new NotionConversationReview(db, publisher);
    expect(resumed.restore(target, "workspace-id")).toMatchObject({
      ...prepared,
      draftText: "Exact body",
    });
    expect(() =>
      resumed.restore(
        { ...target, parentId: "33333333-3333-4333-8333-333333333333" },
        "workspace-id",
      ),
    ).toThrow();
    expect(() => resumed.restore(target, "other-workspace")).toThrow();
    expect(() =>
      resumed.restore(target, "workspace-id", "foreign-product"),
    ).toThrow();
    expect(db.prepare("SELECT count(*) FROM actions").pluck().get()).toBe(1);
    expect(publisher.create).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});
