import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { WorkStore } from "../src/work-store.ts";

// Add, read, edit and delete for every kind of work the owner can have:
// a product, a project, a task and an RFP.
let db: Database.Database;
let store: WorkStore;
beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  store = new WorkStore(db);
});
type Result = { ok: boolean; message: string; ref: string | null };
const send = (action: string, extra: Record<string, unknown> = {}) =>
  store
    .handle({ version: 1, kind: "work", action, ...extra })
    .find(
      (event) => (event as { kind: string }).kind === "work-result",
    ) as Result;
const snap = () => store.snapshot();
const find = (id: string) => snap().areas.find((area) => area.id === id);

const kinds = ["product", "project", "task", "rfp"] as const;
const add = (type: (typeof kinds)[number], name: string) =>
  type === "rfp"
    ? send("save-rfp", { groupId: null, name, client: "DMT" }).ref!
    : send("create-area", { groupId: null, type, name }).ref!;

describe.each(kinds)("a %s", (type) => {
  it("is added, read back, renamed, edited and deleted", () => {
    // Add
    const id = add(type, "First name");
    expect(id).toBeTruthy();
    // Read
    expect(find(id)).toMatchObject({ type, name: "First name" });
    // Edit: the name
    expect(
      send("update-area", { areaId: id, patch: { name: "Second name" } }).ok,
    ).toBe(true);
    expect(find(id)?.name).toBe("Second name");
    // Edit: something else, leaving the name alone
    expect(
      send("update-area", {
        areaId: id,
        patch: { purpose: "Why this exists", dueAt: "2026-12-01" },
      }).ok,
    ).toBe(true);
    expect(find(id)).toMatchObject({
      name: "Second name",
      purpose: "Why this exists",
      dueAt: "2026-12-01",
    });
    // Delete
    expect(send("delete-area", { areaId: id }).ok).toBe(true);
    expect(find(id)).toBeUndefined();
    expect(snap().areas).toEqual([]);
    if (type === "rfp") expect(snap().rfps).toEqual([]);
  });

  it("takes its chat, plans and waiting items with it", () => {
    const id = add(type, "Going away");
    const other = add(type, "Staying");
    send("message", { workAreaId: id, role: "you", text: "Hello" });
    send("message", { workAreaId: other, role: "you", text: "Still here" });
    send("propose-plan", {
      groupId: null,
      workAreaId: id,
      planKind: "stories",
      destination: "ado",
      summary: "One story",
      items: [{ id: "s1", summary: "A story", fields: {} }],
    });
    send("attention", {
      attentionKind: "question",
      groupId: null,
      workAreaId: id,
      title: "A question",
      detail: "",
      options: [],
    });
    const draft = send("save-output", {
      groupId: null,
      type: "doc",
      title: "A draft",
      body: "Text",
      workAreaIds: [id, other],
    }).ref!;
    expect(snap().plans).toHaveLength(1);
    expect(snap().attention.length).toBeGreaterThan(0);

    send("delete-area", { areaId: id });
    const after = snap();
    expect(after.areas.map((area) => area.id)).toEqual([other]);
    expect(after.messages.map((message) => message.text)).toEqual([
      "Still here",
    ]);
    expect(after.plans).toEqual([]);
    expect(after.attention).toEqual([]);
    expect(after.activity.every((row) => row.workAreaId !== id)).toBe(true);
    // A draft filed under both stays, filed under the one that remains.
    expect(
      after.library.find((item) => item.id === draft)?.workAreaIds,
    ).toEqual([other]);
  });

  it("cannot be changed or deleted again once deleted", () => {
    const id = add(type, "Once");
    send("delete-area", { areaId: id });
    expect(
      send("update-area", { areaId: id, patch: { name: "Back" } }),
    ).toMatchObject({ ok: false, message: "That work area no longer exists." });
    expect(send("delete-area", { areaId: id })).toMatchObject({
      ok: false,
      message: "That work area no longer exists.",
    });
    expect(snap().areas).toEqual([]);
  });

  it("frees its name, so a new one can be added with the same name", () => {
    const first = add(type, "Same name");
    send("delete-area", { areaId: first });
    const second = add(type, "Same name");
    expect(second).not.toBe(first);
    expect(snap().areas.map((area) => area.id)).toEqual([second]);
  });
});

describe("rules that hold for every kind", () => {
  it("refuses an empty name and keeps the old one", () => {
    const id = add("project", "Named");
    expect(
      send("update-area", { areaId: id, patch: { name: "   " } })?.ok ?? false,
    ).toBe(false);
    expect(find(id)?.name).toBe("Named");
  });

  it("cannot be deleted by setting its status", () => {
    const id = add("task", "Careful");
    expect(
      send("update-area", { areaId: id, patch: { status: "deleted" } }),
    ).toMatchObject({ ok: false });
    expect(find(id)?.name).toBe("Careful");
  });

  it("renames a product's own record with it, and a deleted product does not come back", () => {
    const id = add("product", "Test Product 1");
    send("update-area", { areaId: id, patch: { name: "Arabic Voice" } });
    expect(db.prepare("SELECT name FROM products").pluck().all()).toEqual([
      "Arabic Voice",
    ]);
    send("delete-area", { areaId: id });
    // Reading again must not re-adopt the product as a new work.
    expect(snap().areas).toEqual([]);
    expect(snap().areas).toEqual([]);
  });

  it("is not offered or opened by a new message that mentions its name", () => {
    send("finish-setup", {
      workTypes: ["project"],
      tools: [],
      agents: [],
      groups: [{ name: "Work", routes: [] }],
    });
    const groupId = snap().groups[0]!.id;
    const id = send("create-area", {
      groupId,
      type: "project",
      name: "Arabic Voice",
    }).ref!;
    const mention = () =>
      store
        .handle({
          version: 1,
          kind: "work",
          action: "intake",
          text: "For Arabic Voice: draft the launch note",
          fileNames: [],
          groupId,
        })
        .find(
          (event) => (event as { kind: string }).kind === "work-result",
        ) as { step?: unknown };
    // While it exists, a message naming it is filed under it.
    expect(JSON.stringify(mention().step)).toContain(id);
    send("delete-area", { areaId: id });
    // Afterwards nothing points at it, as a destination or as a choice.
    expect(JSON.stringify(mention().step)).not.toContain(id);
  });

  it("takes no new message, plan, sprint or roadmap item once deleted", () => {
    const id = add("project", "Closed");
    send("delete-area", { areaId: id });
    const gone = { ok: false, message: "That work area no longer exists." };
    expect(
      send("message", { workAreaId: id, role: "you", text: "Hello" }),
    ).toMatchObject(gone);
    expect(
      send("propose-plan", {
        groupId: null,
        workAreaId: id,
        planKind: "stories",
        destination: "ado",
        summary: "One story",
        items: [{ id: "s1", summary: "A story", fields: {} }],
      }),
    ).toMatchObject(gone);
    expect(snap().messages).toEqual([]);
    expect(snap().plans).toEqual([]);
  });

  it("drops a link between two works when one is deleted", () => {
    const rfp = add("rfp", "Smart Inspection");
    const project = add("project", "Smart Inspection delivery");
    send("relate-areas", { fromId: project, toId: rfp, relation: "handoff" });
    expect(snap().relations).toHaveLength(1);
    send("delete-area", { areaId: rfp });
    expect(snap().relations).toEqual([]);
    expect(snap().areas.map((area) => area.id)).toEqual([project]);
  });

  it("leaves nothing outside Amun to do: deleting never queues a write", () => {
    const id = add("product", "With a plan");
    const planId = send("propose-plan", {
      groupId: null,
      workAreaId: id,
      planKind: "stories",
      destination: "ado",
      summary: "One story",
      items: [{ id: "s1", summary: "A story", fields: {} }],
    }).ref!;
    send("delete-area", { areaId: id });
    expect(
      db
        .prepare("SELECT count(*) FROM plan_writes WHERE plan_id=?")
        .pluck()
        .get(planId),
    ).toBe(0);
  });
});

describe("what an agent is doing", () => {
  const agent = (role: string) =>
    snap().agents.find((item) => item.role === role);
  it("is shown as working, then done with its output, and Firstmate leads", () => {
    send("agent-status", {
      role: "QA",
      state: "working",
      nowDoing: "Check the booking flow",
    });
    expect(agent("QA")).toMatchObject({
      state: "working",
      nowDoing: "Check the booking flow",
      enabled: true,
    });
    expect(snap().agents[0]).toMatchObject({ role: "Firstmate", kind: "lead" });
    send("agent-status", {
      role: "qa",
      state: "done",
      nowDoing: null,
      output: "Double booking is possible.",
    });
    expect(snap().agents.filter((item) => /qa/i.test(item.role))).toHaveLength(
      1,
    );
    expect(agent("QA")).toMatchObject({
      state: "done",
      nowDoing: null,
      output: "Double booking is possible.",
    });
  });
});
