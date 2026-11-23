import { describe, expect, it } from "vitest";
import { openWorkStore } from "../src/index.ts";

// Idea to Done §4.8: one receipt per approved plan, in the chat of the
// request that asked; the request turns Ready only when all was created.
describe("the publish receipt", () => {
  it("lands once in the asking chat, updates in place and makes the request Ready", () => {
    const work = openWorkStore(":memory:");
    const send = (action: string, extra: object = {}) =>
      work.store
        .handle({ version: 1, kind: "work", action, ...extra })
        .find(
          (event) => (event as { kind?: string }).kind === "work-result",
        ) as { ok: boolean; ref: string | null; message: string };
    send("add-group", { name: "Work" });
    const group = work.store.snapshot().groups[0]!.id;
    const area = send("create-area", {
      groupId: group,
      type: "project",
      name: "Invoiced",
    }).ref!;
    const chat = send("new-chat", { workAreaId: area }).ref!;
    const other = send("new-chat", { workAreaId: area }).ref!;
    const ref = "amun-r-aaaaaaaaaaaa";
    const asked = send("message", {
      workAreaId: area,
      chatId: chat,
      role: "you",
      text: "Publish the epics to Linear.",
      card: { kind: "request", ref },
    }).ref!;
    send("register-request", { ref, messageId: asked, projectAreaId: area });
    const planId = send("propose-plan", {
      groupId: null,
      workAreaId: area,
      planKind: "stories",
      destination: "linear",
      summary: "Invoiced plan",
      items: [
        { id: "e1", summary: "Customers", fields: { type: "Epic" } },
        {
          id: "s1",
          summary: "Add a customer",
          fields: { type: "Story", parent: "Customers" },
        },
      ],
      chatId: other,
      requestRef: ref,
    }).ref!;
    const plan = () =>
      work.store.snapshot().plans.find((p) => p.id === planId)!;
    expect(
      send("approve-plan", { planId, fingerprint: plan().fingerprint }).ok,
    ).toBe(true);

    const receipts = () =>
      work.store
        .snapshot()
        .chats.flatMap((c) =>
          c.messages.map((m) => ({
            ...m,
            chatId: c.id,
            workAreaId: c.workAreaId,
          })),
        )
        .filter(
          (m) =>
            (m.card as { kind?: string } | null)?.kind === "publish-receipt",
        );
    const request = () =>
      work.store.snapshot().requests.find((r) => r.ref === ref)!;

    const first = send("record-results", {
      planId,
      results: [
        {
          id: "e1",
          state: "created",
          externalId: "P-TRA-3",
          url: "https://linear.app/p/3",
        },
        { id: "s1", state: "failed" },
      ],
    });
    expect(first.message).toBe("");
    expect(receipts()).toHaveLength(1);
    expect(receipts()[0]).toMatchObject({ workAreaId: area, chatId: chat });
    expect(receipts()[0]!.card).toMatchObject({
      state: "partial",
      created: 1,
      total: 2,
      items: [
        {
          summary: "Customers",
          key: "P-TRA-3",
          state: "created",
          parent: null,
        },
        { summary: "Add a customer", state: "failed", parent: "Customers" },
      ],
    });
    expect(request().status).toBe("needs-decision");

    send("record-results", {
      planId,
      results: [{ id: "s1", state: "created", externalId: "TRA-101" }],
    });
    expect(receipts()).toHaveLength(1);
    expect(receipts()[0]!.card).toMatchObject({
      state: "published",
      created: 2,
    });
    expect(request().status).toBe("delivered");
    work.close();
  });
});

describe("published items in the delivery summary", () => {
  it("turn a same-titled draft Published and add the rest, with their epic", () => {
    const work = openWorkStore(":memory:");
    const send = (action: string, extra: object = {}) =>
      work.store
        .handle({ version: 1, kind: "work", action, ...extra })
        .find(
          (event) => (event as { kind?: string }).kind === "work-result",
        ) as { ok: boolean; ref: string | null };
    send("add-group", { name: "Work" });
    const group = work.store.snapshot().groups[0]!.id;
    const area = send("create-area", {
      groupId: group,
      type: "project",
      name: "Invoiced",
    }).ref!;
    const product = send("start-delivery", { workAreaId: area }).ref!;
    work.db
      .prepare(
        "INSERT INTO work_items(id,product_id,type,title,status) VALUES ('d1',?,'story','Add a customer','draft'),('d2',?,'story','Merge duplicates','draft')",
      )
      .run(product, product);
    const planId = send("propose-plan", {
      groupId: null,
      workAreaId: area,
      planKind: "stories",
      destination: "linear",
      summary: "Invoiced plan",
      items: [
        { id: "e1", summary: "Customers", fields: { type: "Epic" } },
        {
          id: "s1",
          summary: "Add a customer",
          fields: { type: "Story", parent: "Customers" },
        },
      ],
    }).ref!;
    const fingerprint = work.store
      .snapshot()
      .plans.find((p) => p.id === planId)!.fingerprint;
    send("approve-plan", { planId, fingerprint });
    send("record-results", {
      planId,
      results: [
        { id: "e1", state: "created", externalId: "P-TRA-3" },
        { id: "s1", state: "created", externalId: "TRA-101" },
      ],
    });
    const summary = work.store
      .snapshot()
      .delivery.find((d) => d.workAreaId === area)!;
    expect(summary.delivery).toBe(true);
    const byTitle = new Map(summary.items.map((i) => [i.title, i]));
    const epic = byTitle.get("Customers")!;
    expect(epic).toMatchObject({
      type: "epic",
      tool: "linear",
      key: "P-TRA-3",
    });
    expect(byTitle.get("Add a customer")).toMatchObject({
      id: "d1",
      tool: "linear",
      key: "TRA-101",
      status: "To do",
      parentId: epic.id,
    });
    expect(byTitle.get("Merge duplicates")).toMatchObject({
      tool: null,
      key: null,
    });

    // The tracker's read-back moves the published story, and only it.
    send("sync-story-status", {
      workAreaId: area,
      items: [
        { tool: "linear", key: "TRA-101", status: "Done" },
        { tool: "jira", key: "TRA-101", status: "Closed" },
      ],
    });
    const after = work.store
      .snapshot()
      .delivery.find((d) => d.workAreaId === area)!;
    expect(after.items.find((i) => i.key === "TRA-101")!.status).toBe("Done");
    expect(after.items.find((i) => i.id === "d2")!.status).toBe("draft");

    // A Notion page is never a story.
    const notion = send("propose-plan", {
      groupId: null,
      workAreaId: area,
      planKind: "edit",
      destination: "notion",
      summary: "PRD page",
      items: [
        {
          id: "n1",
          summary: "Merge duplicates",
          fields: { title: "Merge duplicates" },
        },
      ],
    }).ref!;
    const print = work.store
      .snapshot()
      .plans.find((p) => p.id === notion)!.fingerprint;
    send("approve-plan", { planId: notion, fingerprint: print });
    send("record-results", {
      planId: notion,
      results: [{ id: "n1", state: "created", externalId: "page-1" }],
    });
    const last = work.store
      .snapshot()
      .delivery.find((d) => d.workAreaId === area)!;
    expect(last.items.find((i) => i.id === "d2")).toMatchObject({
      tool: null,
      key: null,
    });
    expect(last.items.some((i) => i.key === "page-1")).toBe(false);
    work.close();
  });
});
