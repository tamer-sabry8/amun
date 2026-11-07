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
      text: "Second exact text",
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
