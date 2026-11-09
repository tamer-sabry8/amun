import { expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { MemorySync } from "../src/memory-sync.ts";
import type {
  SyncCommand,
  MemoryLink,
} from "../../contracts/src/memory-sync.ts";
import type { RemoteField } from "../../domain/src/memory-sync.ts";
import type { NotionConnection } from "../../auth/src/notion-connection.ts";
const page = "11111111-1111-4111-8111-111111111111";
it("retains offline edits and conflict choices through reopen, distinguishes loss of access from deletion, and guards stale reviews", async () => {
  const db = new Database(":memory:");
  migrate(db);
  try {
    db.exec(
      "INSERT INTO products(id,name,created_at) VALUES('p','Product','now'); INSERT INTO sources(id,product_id,kind,title,hash,retrieved_at) VALUES('s','p','note','Test','test','now'); INSERT INTO memory_entities(id,product_id,type,data_json,source_id,updated_at) VALUES('r','p','fact','{\"text\":\"Draft\",\"other\":\"retain\"}','s','now')",
    );
    let selected = "p",
      sync = new MemorySync(db, () => selected);
    let remote: RemoteField = { kind: "value", value: "Draft" };
    const writes: string[] = [];
    const provider = {
      memoryField: vi.fn(
        async (req: Parameters<NotionConnection["memoryField"]>[0]) => {
          if (
            req.edit &&
            remote.kind === "value" &&
            remote.value === req.edit.before
          ) {
            req.edit.assertCurrent();
            writes.push(req.edit.after);
            remote = { kind: "value", value: req.edit.after };
          }
          return { workspace: "workspace", remote };
        },
      ),
    };
    const base = { version: 1, kind: "workspace", productId: "p" } as const;
    const link = () => sync.list("p")[0]!;
    const map = () =>
      sync.run(
        {
          ...base,
          action: "link-memory",
          record: "r",
          field: "text",
          label: "Sync status",
          url: "https://www.notion.so/" + page,
        },
        provider,
      );
    const review = (
      choice: Extract<SyncCommand, { action: "sync-memory-field" }>["choice"],
      row: MemoryLink = link(),
    ) =>
      sync.run(
        {
          ...base,
          action: "sync-memory-field",
          link: row.id,
          review: row,
          choice,
        },
        provider,
      );
    await map();
    await review("refresh");
    expect(link()).toMatchObject({ baseline: "Draft", state: "synced" });
    await sync.run(
      {
        ...base,
        action: "edit-memory-field",
        link: link().id,
        before: "Draft",
        value: "Local",
      },
      provider,
    );
    remote = { kind: "unavailable" };
    await review("refresh");
    expect(link()).toMatchObject({
      state: "unavailable",
      local: "Local",
      baseline: "Draft",
    });
    for (const failure of ["HTTP 403: access revoked", "Network offline"]) {
      provider.memoryField.mockRejectedValueOnce(new Error(failure));
      await review("refresh");
      expect(link()).toMatchObject({
        state: "unavailable",
        local: "Local",
        baseline: "Draft",
      });
    }
    remote = { kind: "value", value: "Remote" };
    await review("refresh");
    expect(link()).toMatchObject({
      state: "conflict",
      local: "Local",
      remote: "Remote",
    });
    const stale = link();
    await review("take-remote");
    sync = new MemorySync(db, () => selected);
    expect(link()).toMatchObject({
      state: "synced",
      local: "Remote",
      baseline: "Remote",
    });
    await expect(review("publish-local", stale)).rejects.toThrow();
    await sync.run(
      {
        ...base,
        action: "edit-memory-field",
        link: link().id,
        before: "Remote",
        value: "Reviewed",
      },
      provider,
    );
    await review("refresh");
    provider.memoryField.mockImplementationOnce(async (request) => {
      request.edit!.assertCurrent();
      writes.push(request.edit!.after);
      remote = { kind: "value", value: request.edit!.after };
      throw Error("Connection lost after applying the edit");
    });
    await review("publish-local");
    expect(link().state).toBe("unconfirmed");
    await expect(review("publish-local")).rejects.toThrow();
    sync = new MemorySync(db, () => selected);
    await review("refresh");
    expect(link()).toMatchObject({ state: "synced", baseline: "Reviewed" });
    expect(
      db
        .prepare("SELECT state FROM actions WHERE kind='publish'")
        .pluck()
        .all(),
    ).toEqual(["succeeded"]);
    expect(writes).toEqual(["Reviewed"]);
    remote = { kind: "deleted" };
    await review("refresh");
    expect(link().state).toBe("deleted");
    selected = "other";
    await expect(review("delete-local")).rejects.toThrow();
    selected = "p";
    await review("keep-local");
    expect(link().state).toBe("kept");
    await review("unlink");
    expect(sync.list("p")).toEqual([]);
    await map();
    await review("refresh");
    await review("delete-local");
    expect(
      db.prepare("SELECT data_json FROM memory_entities").pluck().get(),
    ).toBe('{"other":"retain"}');
  } finally {
    db.close();
  }
});
