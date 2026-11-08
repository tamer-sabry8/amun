import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { WorkspaceService } from "../src/workspace-service.ts";
it("persists theme/preferences and returns only validated shared records after reconnect", () => {
  const db = new Database(":memory:");
  migrate(db);
  db.prepare("INSERT INTO products(id,name,created_at) VALUES (?,?,?)").run(
    "p",
    "Product",
    "now",
  );
  const service = new WorkspaceService(db);
  const first = service.snapshot();
  expect(first.preferences.theme).toBe("tamer-sabry-default");
  const response = service.handle({
    version: 1,
    kind: "workspace",
    action: "preferences",
    preferences: { ...first.preferences, theme: "navy-cyan", productId: "p" },
  });
  expect(response?.kind).toBe("workspace-snapshot");
  expect(new WorkspaceService(db).snapshot().preferences.theme).toBe(
    "navy-cyan",
  );
  expect(
    service.handle({
      version: 1,
      kind: "workspace",
      action: "preferences",
      preferences: { theme: "hacked" },
    }),
  ).toBeUndefined();
  expect(
    service.handle({
      version: 1,
      kind: "workspace",
      action: "search",
      productId: "p",
      query: "Product",
    }),
  ).toMatchObject({
    kind: "workspace-search",
    results: [{ id: "p", kind: "product", title: "Product" }],
  });
  db.close();
});
it("does not persist invalid product selections or leak storage errors", () => {
  const db = new Database(":memory:");
  migrate(db);
  const service = new WorkspaceService(db);
  expect(
    service.handle({
      version: 1,
      kind: "workspace",
      action: "preferences",
      preferences: { ...service.snapshot().preferences, productId: "unknown" },
    }),
  ).toMatchObject({ kind: "workspace-error" });
  expect(service.snapshot().preferences.productId).toBeNull();
  expect(
    service.handle({
      version: 1,
      kind: "workspace",
      action: "resolve",
      id: "missing",
      source: "review",
    }),
  ).toEqual({
    version: 1,
    kind: "workspace-error",
    message:
      "The workspace change could not be completed. Refresh and try again.",
  });
  db.close();
});

it("shows workspace-scoped Notion progress without breaking the workspace snapshot", async () => {
  const { NotionConversationReview } = await import("../src/notion-review.ts");
  const db = new Database(":memory:");
  migrate(db);
  try {
    const review = new NotionConversationReview(db, {
      create: async () => ({ state: "unknown" as const }),
    }).prepare(
      { title: "Reviewed conversation", text: "Approved content" },
      {
        title: "Documents",
        parentId: "11111111-1111-4111-8111-111111111111",
        parentType: "page_id",
        titleProperty: "title",
      },
      "workspace",
    );
    const service = new WorkspaceService(db);
    for (const [state, kind, display] of [
      ["executing", "publication", "working"],
      ["unknown", "reconciliation", "waiting"],
      ["failed", "publication", "failed"],
    ]) {
      db.prepare("UPDATE actions SET state=? WHERE id=?").run(state, review.id);
      const snapshot = service.handle({
        version: 1,
        kind: "workspace",
        action: "snapshot",
      });
      expect(snapshot).toMatchObject({
        kind: "workspace-snapshot",
        activities: [{ productId: null, kind, state: display, ref: review.id }],
      });
    }
  } finally {
    db.close();
  }
});
