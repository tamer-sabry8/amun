import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../src/sqlite.ts";
import { migrate } from "../src/database.ts";
import { WorkStore } from "../src/work-store.ts";

// Add, read, edit and delete for every kind of work the owner can have:
// a product, a project, a task and an RFP.
let db: Database;
let store: WorkStore;
beforeEach(() => {
  db = openDatabase(":memory:");
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

  it("keeps an optional client on a project only, and clears it when emptied", () => {
    const id = send("create-area", {
      groupId: null,
      type: "project",
      name: "Portal",
      client: "Acme",
    }).ref!;
    expect(find(id)?.client).toBe("Acme");
    send("update-area", { areaId: id, patch: { client: "  Globex  " } });
    expect(find(id)?.client).toBe("Globex");
    send("update-area", { areaId: id, patch: { client: "" } });
    expect(find(id)?.client).toBeNull();
    for (const type of ["product", "task"] as const) {
      const other = add(type, "Not a project");
      expect(
        send("update-area", { areaId: other, patch: { client: "Acme" } }).ok,
      ).toBe(false);
      expect(find(other)?.client).toBeNull();
    }
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

describe("an agent that starts a new task", () => {
  it("does not keep showing the last task's output", () => {
    const role = (name: string) =>
      snap().agents.find((item) => item.role === name);
    send("agent-status", {
      role: "Analyst",
      state: "working",
      nowDoing: "Competitive analysis",
    });
    send("agent-status", {
      role: "Analyst",
      state: "done",
      nowDoing: null,
      output: "# Competitive analysis",
    });
    // The finished output stays visible while the agent is idle.
    expect(role("Analyst")!.output).toBe("# Competitive analysis");
    send("agent-status", {
      role: "Analyst",
      state: "working",
      nowDoing: "A new note",
    });
    expect(role("Analyst")).toMatchObject({
      nowDoing: "A new note",
      output: "",
    });
    send("agent-status", {
      role: "Analyst",
      state: "working",
      nowDoing: "A new note",
      output: "Draft so far",
    });
    expect(role("Analyst")!.output).toBe("Draft so far");
  });
});

describe("blockers", () => {
  const blockers = () => snap().blockers;
  it("record who owns them and when they were raised, and can be re-owned and cleared", () => {
    const area = add("project", "Portal");
    const id = send("raise-blocker", {
      areaId: area,
      title: "API key",
      owner: " Priya ",
    }).ref!;
    expect(blockers()).toEqual([
      expect.objectContaining({
        id,
        workAreaId: area,
        title: "API key",
        owner: "Priya",
        resolvedAt: null,
      }),
    ]);
    expect(blockers()[0]!.raisedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(send("set-blocker-owner", { blockerId: id, owner: "Sam" }).ok).toBe(
      true,
    );
    expect(blockers()[0]!.owner).toBe("Sam");
    expect(send("set-blocker-owner", { blockerId: id, owner: "" }).ok).toBe(
      true,
    );
    expect(blockers()[0]!.owner).toBeNull();
    expect(send("resolve-blocker", { blockerId: id }).ok).toBe(true);
    expect(blockers()[0]!.resolvedAt).not.toBeNull();
    // A cleared blocker cannot be re-owned, and clearing twice is harmless.
    expect(send("set-blocker-owner", { blockerId: id, owner: "Lee" }).ok).toBe(
      false,
    );
    expect(send("resolve-blocker", { blockerId: id }).ok).toBe(true);
  });
  it("retains a blocker link across reopen and rejects a conflicting sprint or area", () => {
    const areaId = add("project", "Portal");
    const blockerId = send("raise-blocker", {
      areaId,
      title: "Access needed",
    }).ref!;
    const link = {
      sourceId: "azure-1",
      sprintId: "iteration-5",
      storyId: "42",
    };
    const args = { areaId, blockerId, ...link };
    expect(
      send("link-blocker-story", { ...args, areaId: add("project", "Other") })
        .ok,
    ).toBe(false);
    expect(send("link-blocker-story", args).ok).toBe(true);
    expect(send("link-blocker-story", args).ok).toBe(true);
    expect(send("link-blocker-story", { ...args, sprintId: "other" }).ok).toBe(
      false,
    );
    expect(new WorkStore(db).snapshot().blockers[0]?.sprintLink).toEqual(link);
    send("resolve-blocker", { blockerId });
    expect(send("link-blocker-story", args).ok).toBe(false);
  });
  it("keeps one nudge in the sprint conversation and distinguishes manual delivery from resolution", async () => {
    const areaId = add("project", "Gitex");
    const blockerId = send("raise-blocker", {
      areaId,
      title: "Badge permission",
      owner: "Sam",
    }).ref!;
    const sprint = { id: "ado:4", connection: "azure", name: "Sprint 4" };
    const chatId = send("new-chat", { workAreaId: areaId, sprint }).ref!;
    send("link-blocker-story", {
      areaId,
      blockerId,
      sourceId: "azure",
      sprintId: sprint.id,
      storyId: "24",
    });
    const ref = "amun-r-123456789abc";
    const args = {
      version: 1,
      kind: "work",
      action: "draft-blocker-message",
      ref,
      areaId,
      blockerId,
      chatId,
    };
    let calls = 0;
    const draft = () =>
      store.draftNudge(args, async () => {
        calls++;
        return "Sam, can you confirm access for badge printing?";
      });
    await Promise.all([draft(), draft()]);
    expect(calls).toBe(1);
    const record = (disposition: string) =>
      send("record-blocker-message", {
        areaId,
        blockerId,
        ref,
        body: "Sam, can you confirm badge access today?",
        disposition,
      });
    expect(record("copied").ok).toBe(true);
    expect(snap().blockers[0]).toMatchObject({
      resolvedAt: null,
      nudge: { state: "copied" },
    });
    expect(record("manual").ok).toBe(true);
    expect(record("manual").ok).toBe(true);
    expect(snap().blockers[0]).toMatchObject({
      resolvedAt: null,
      nudge: { state: "manual" },
    });
    const messages = snap().chats.find((c) => c.id === chatId)!.messages;
    expect(messages).toHaveLength(2);
    expect(messages[1]?.text).toContain("Sent manually · confirmed by you");
  });
  it("need a work area, and go with it when it is deleted", () => {
    expect(send("raise-blocker", { areaId: "nope", title: "X" }).ok).toBe(
      false,
    );
    const area = add("task", "Job");
    send("raise-blocker", { areaId: area, title: "Waiting on legal" });
    expect(blockers()).toHaveLength(1);
    send("delete-area", { areaId: area });
    expect(blockers()).toEqual([]);
  });
  it("hide secrets in the title and owner", () => {
    const area = add("task", "Job");
    send("raise-blocker", {
      areaId: area,
      title: "Need token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });
    expect(blockers()[0]!.title).not.toContain("ghp_abcdef");
  });
});

describe("document versions and approval", () => {
  const doc = (extra: Record<string, unknown>) =>
    send("save-output", { groupId: null, type: "doc", title: "BRD", ...extra });
  const item = (id: string) => snap().library.find((entry) => entry.id === id)!;

  it("keeps a version per content change, with its author", () => {
    const id = doc({ body: "one", author: "firstmate" }).ref!;
    doc({ outputId: id, body: "one" });
    doc({ outputId: id, body: "one", title: "BRD renamed" });
    doc({ outputId: id, body: "two" });
    const saved = item(id);
    expect(saved.version).toBe(2);
    expect(saved.versions.map((v) => [v.version, v.author, v.body])).toEqual([
      [2, "owner", "two"],
      [1, "firstmate", "one"],
    ]);
  });

  it("restores an old version as a new one", () => {
    const id = doc({ body: "one" }).ref!;
    doc({ outputId: id, body: "two" });
    expect(
      send("restore-output-version", { outputId: id, versionNumber: 1 }).ok,
    ).toBe(true);
    expect(item(id)).toMatchObject({ body: "one", version: 3 });
    expect(
      send("restore-output-version", { outputId: id, versionNumber: 9 }).ok,
    ).toBe(false);
  });

  it("records the approved version and never carries it to later changes", () => {
    const id = doc({ body: "one" }).ref!;
    doc({ outputId: id, body: "two" });
    send("approve-output", { outputId: id, approved: true });
    expect(item(id)).toMatchObject({ version: 2, approvedVersion: 2 });
    doc({ outputId: id, body: "three" });
    expect(item(id)).toMatchObject({ version: 3, approvedVersion: 2 });
    send("approve-output", { outputId: id, approved: false });
    expect(item(id).approvedVersion).toBeNull();
    expect(
      send("approve-output", { outputId: "nope", approved: true }).ok,
    ).toBe(false);
  });

  it("records the owner's acceptance of a checklist on the version decided, apart from approval", () => {
    const id = doc({
      type: "acceptance",
      body: "- [ ] A — Evidence: PR 1",
    }).ref!;
    doc({ outputId: id, type: "acceptance", body: "- [ ] A — Evidence: PR 2" });
    const decide = (decision: string | null, reason = "") =>
      send("record-acceptance", { outputId: id, decision, reason });
    expect(decide("accepted").ok).toBe(false);
    expect(decide("not_yet", "Billing has no evidence yet").ok).toBe(true);
    expect(item(id).acceptance).toMatchObject({
      decision: "not_yet",
      version: 2,
      reason: "Billing has no evidence yet",
    });
    expect(item(id).approvedVersion).toBeNull();
    doc({ outputId: id, type: "acceptance", body: "changed" });
    expect(item(id).acceptance?.version).toBe(2);
    expect(decide("accepted", "All cited").ok).toBe(true);
    expect(item(id).acceptance).toMatchObject({
      decision: "accepted",
      version: 3,
    });
    expect(decide(null).ok).toBe(true);
    expect(item(id).acceptance).toBeNull();
    const plain = doc({ body: "x" }).ref!;
    expect(
      send("record-acceptance", {
        outputId: plain,
        decision: "accepted",
        reason: "ok",
      }).ok,
    ).toBe(false);
  });
});

it("retains one navigation dispatch after loss of acknowledgement and keeps it out of chat", async () => {
  const areaId = add("project", "Gitex");
  const ref = "amun-r-abcdef123456",
    prompt = "Open sprint detail. Read-only.";
  send("navigation-activity", {
    ref,
    workAreaId: areaId,
    prompt,
    delivered: false,
  });
  let sent = 0;
  const uncertain = await store.inspectNavigation(
    ref,
    "work",
    prompt,
    async () => {
      sent++;
      throw Error("lost acknowledgement");
    },
  );
  expect(uncertain.delivered).toBe(false);
  const reopened = new WorkStore(db);
  expect(
    await reopened.inspectNavigation(ref, "work", prompt, async () => {
      sent++;
    }),
  ).toEqual({ delivered: false });
  expect(sent).toBe(1);
  expect(reopened.snapshot().activity.find((a) => a.ref === ref)).toMatchObject(
    { text: prompt, state: "failed" },
  );
  expect(reopened.snapshot().messages).toHaveLength(0);
});
