import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { WorkStore } from "../src/work-store.ts";
import type { WorkSnapshot } from "../../contracts/src/work.ts";

let db: Database.Database;
let store: WorkStore;
let clock: number;
const tick = () => new Date((clock += 1000));

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  clock = Date.parse("2026-11-12T08:00:00Z");
  store = new WorkStore(db, undefined, tick);
});

type Result = {
  ok: boolean;
  message: string;
  ref: string | null;
  step: unknown;
};
function send(action: string, extra: Record<string, unknown> = {}) {
  const events = store.handle({ version: 1, kind: "work", action, ...extra });
  const result = events.find((event) => event.kind === "work-result") as
    (Result & { kind: string }) | undefined;
  if (!result) throw Error("No result for " + action);
  return result as Result;
}
const snap = () => store.snapshot();
function setup() {
  send("finish-setup", {
    workTypes: ["product", "project", "task", "rfp"],
    tools: ["ado", "notion"],
    agents: ["Researcher", "Analyst"],
    groups: [
      {
        name: "Employer",
        routes: [
          { condition: "delivery", tracker: "ado" },
          { condition: null, tracker: "notion" },
        ],
      },
      { name: "Side business", routes: [] },
    ],
  });
  const groups = snap().groups;
  return { employer: groups[0]!.id, side: groups[1]!.id };
}
const area = (groupId: string | null, type: string, name: string) =>
  send("create-area", { groupId, type, name }).ref!;

describe("migration 29", () => {
  it("adopts existing products as product work areas without a group", () => {
    const fresh = new Database(":memory:");
    migrate(fresh, 28);
    fresh
      .prepare(
        "INSERT INTO products(id,name,created_at) VALUES('p','MARC','2026-11-01')",
      )
      .run();
    migrate(fresh);
    expect(
      fresh
        .prepare("SELECT id,type,name,group_id,product_id FROM work_areas")
        .all(),
    ).toEqual([
      {
        id: "area-p",
        type: "product",
        name: "MARC",
        group_id: null,
        product_id: "p",
      },
    ]);
    expect(fresh.prepare("SELECT count(*) AS n FROM products").get()).toEqual({
      n: 1,
    });
  });
  it("adopts products created later through earlier flows", () => {
    db.prepare(
      "INSERT INTO products(id,name,created_at) VALUES('late','Late','2026-11-02')",
    ).run();
    expect(snap().areas.map((item) => item.productId)).toEqual(["late"]);
    expect(snap().areas).toHaveLength(1);
  });
});

describe("setup (wizard)", () => {
  it("starts incomplete and ignores malformed commands", () => {
    expect(snap().setup).toMatchObject({
      completed: false,
      step: "models",
      theme: "system",
    });
    expect(store.handle({ kind: "work", action: "nope" })).toEqual([]);
  });
  it("creates groups, conditional routes, Firstmate and the chosen agents", () => {
    const { employer } = setup();
    const state = snap();
    expect(state.setup).toMatchObject({ completed: true, activeGroupId: null });
    expect(
      state.routes.map((route) => [
        route.groupId === employer,
        route.condition,
        route.tracker,
      ]),
    ).toEqual([
      [true, "delivery", "ado"],
      [true, null, "notion"],
    ]);
    expect(state.agents.map((agent) => [agent.role, agent.kind])).toEqual([
      ["Firstmate", "lead"],
      ["Researcher", "always_on"],
      ["Analyst", "always_on"],
    ]);
    // Setup only: it never starts work.
    expect(state.areas).toEqual([]);
    expect(state.activity).toEqual([]);
  });
  it("uses a single group as the active context", () => {
    send("finish-setup", {
      workTypes: [],
      tools: [],
      agents: [],
      groups: [{ name: "Personal", routes: [] }],
    });
    expect(snap().setup.activeGroupId).toBe(snap().groups[0]!.id);
  });
  it("saves setup patches, renames groups and replaces a route", () => {
    const { employer, side } = setup();
    send("setup", { patch: { theme: "amun-light", libraryView: "list" } });
    expect(snap().setup).toMatchObject({
      theme: "amun-light",
      libraryView: "list",
      completed: true,
    });
    expect(send("rename-group", { groupId: side, name: "Employer" }).ok).toBe(
      false,
    );
    send("rename-group", { groupId: side, name: "Studio" });
    expect(snap().groups[1]!.name).toBe("Studio");
    send("set-route", {
      groupId: employer,
      condition: null,
      tracker: "github",
    });
    expect(
      snap()
        .routes.filter((route) => route.condition === null)
        .map((route) => route.tracker),
    ).toEqual(["github"]);
    expect(send("add-group", { name: "employer" }).ref).toBe(employer);
  });
});

describe("intake (F1) and linking (F2)", () => {
  it("asks which group when several exist and none is active", () => {
    setup();
    expect(
      send("intake", { text: "interview about onboarding", groupId: null })
        .step,
    ).toMatchObject({
      step: "ask_group",
    });
    expect(snap().records).toEqual([]);
  });
  it("saves an interview as an unresolved record and asks where it belongs", () => {
    const { employer } = setup();
    const result = send("intake", {
      text: "Interview about onboarding friction",
      groupId: employer,
    });
    expect(result.step).toMatchObject({
      step: "save_record",
      type: "interview",
      ask: "link",
    });
    expect(snap().records).toMatchObject([
      {
        type: "interview",
        linkage: "unresolved",
        groupId: employer,
        links: [],
      },
    ]);
    // No implementation ticket, plan or work area is created from a record.
    expect(snap().plans).toEqual([]);
    expect(snap().areas).toEqual([]);
  });
  it("files confident work and offers options otherwise, never duplicating", () => {
    const { employer } = setup();
    const id = area(employer, "product", "Agentic Platform");
    expect(
      send("intake", { text: "agentic platform roadmap", groupId: employer }),
    ).toMatchObject({
      ref: id,
      step: { step: "file_work", areaId: id },
    });
    expect(
      send("intake", { text: "start a new product", groupId: employer }).step,
    ).toMatchObject({
      step: "choose_work",
      type: "product",
    });
    expect(
      send("create-area", {
        groupId: employer,
        type: "product",
        name: "agentic platform",
      }),
    ).toMatchObject({
      ref: id,
      message: "That already exists, so I opened it.",
    });
    expect(snap().areas).toHaveLength(1);
  });
  it("creates a product row so earlier PRD and backlog flows still apply", () => {
    const { employer } = setup();
    area(employer, "product", "MARC");
    expect(db.prepare("SELECT name FROM products").all()).toEqual([
      { name: "MARC" },
    ]);
    area(employer, "task", "Book venue");
    expect(db.prepare("SELECT count(*) AS n FROM products").get()).toEqual({
      n: 1,
    });
  });
  it("reports unreadable material without discarding it", () => {
    const { employer } = setup();
    expect(send("intake", { text: "", groupId: employer })).toMatchObject({
      ok: false,
      step: { step: "unreadable" },
    });
  });
  it("supports link now, link later and intentionally unlinked", () => {
    const { employer } = setup();
    const alpha = area(employer, "product", "Alpha");
    const beta = area(employer, "project", "Beta");
    const record = send("save-record", {
      groupId: employer,
      type: "interview",
      title: "Call",
    }).ref!;
    send("link-record", { recordId: record, choice: "later" });
    expect(snap().library.find((item) => item.id === record)).toMatchObject({
      needsLinking: true,
      status: "Needs linking",
    });
    send("link-record", {
      recordId: record,
      choice: "link",
      workAreaIds: [alpha, beta],
    });
    expect(snap().records[0]).toMatchObject({
      linkage: "linked",
      links: [alpha, beta].sort(),
    });
    send("link-record", { recordId: record, choice: "never" });
    expect(snap().records[0]).toMatchObject({ linkage: "unlinked", links: [] });
    expect(
      snap().library.find((item) => item.id === record)!.needsLinking,
    ).toBe(false);
    expect(
      send("link-record", { recordId: record, choice: "link", workAreaIds: [] })
        .ok,
    ).toBe(false);
  });
  it("asks before using a record in another group and honours a specific grant", () => {
    const { employer, side } = setup();
    const supplier = area(side, "task", "Supplier research");
    const record = send("save-record", {
      groupId: employer,
      type: "document",
      title: "Research",
    }).ref!;
    const blocked = send("link-record", {
      recordId: record,
      choice: "link",
      workAreaIds: [supplier],
    });
    expect(blocked).toMatchObject({
      ok: false,
      step: { reason: "cross_group", workAreaIds: [supplier] },
    });
    expect(snap().records[0]!.links).toEqual([]);
    const grant = send("grant-cross-group", {
      sourceGroupId: employer,
      targetGroupId: side,
      information: "Research document",
      purpose: "Supplier comparison",
      targetRef: record,
    }).ref!;
    expect(
      send("link-record", {
        recordId: record,
        choice: "link",
        workAreaIds: [supplier],
      }).ok,
    ).toBe(true);
    // The grant is narrow: another record still needs its own permission.
    const other = send("save-record", {
      groupId: employer,
      type: "idea",
      title: "Other",
    }).ref!;
    expect(
      send("link-record", {
        recordId: other,
        choice: "link",
        workAreaIds: [supplier],
      }).ok,
    ).toBe(false);
    send("revoke-grant", { grantId: grant });
    expect(snap().grants[0]!.revokedAt).not.toBeNull();
    expect(
      send("grant-cross-group", {
        sourceGroupId: employer,
        targetGroupId: employer,
        information: "x",
        purpose: "y",
      }).ok,
    ).toBe(false);
  });
});

describe("objectives (Q56)", () => {
  it("keeps one shared objective linked to several work areas in its group", () => {
    const { employer, side } = setup();
    const task = area(employer, "task", "Reduce non-billable allocation");
    const project = area(employer, "project", "Delivery");
    const id = send("save-objective", {
      groupId: employer,
      metric: "% billable",
      baseline: 60,
      target: 90,
      current: 60,
      workAreaIds: [task, project],
    }).ref!;
    send("save-objective", {
      objectiveId: id,
      groupId: employer,
      metric: "% billable",
      baseline: 60,
      target: 90,
      current: 75,
      workAreaIds: [task],
    });
    expect(snap().objectives).toMatchObject([
      { id, current: 75, links: [task] },
    ]);
    const elsewhere = area(side, "task", "Other");
    expect(
      send("save-objective", {
        groupId: employer,
        metric: "m",
        baseline: null,
        target: null,
        current: null,
        workAreaIds: [elsewhere],
      }).ok,
    ).toBe(false);
  });
});

describe("permissions (§8)", () => {
  it("lists standing permissions and refuses one that would cover a gate", () => {
    const { employer } = setup();
    const id = send("add-permission", {
      groupId: employer,
      destination: "notion",
      permit: "create",
    }).ref!;
    expect(
      send("add-permission", {
        groupId: employer,
        destination: "ado",
        permit: "create",
      }),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "Writing to Azure DevOps always needs your approval",
      ),
    });
    expect(
      send("add-permission", {
        groupId: employer,
        destination: "amun",
        permit: "roadmap_commit",
      }).ok,
    ).toBe(false);
    send("revoke-permission", { permissionId: id });
    expect(snap().permissions).toMatchObject([
      { destination: "notion", revokedAt: expect.any(String) },
    ]);
  });
  it("proposes a learned rule after five independent cases and remembers the answer", () => {
    const { employer } = setup();
    const rule = {
      groupId: employer,
      situation: "sheet-vs-project",
      resolution: "use the approved sheet",
    };
    for (let index = 0; index < 4; index++)
      send("rule-case", { ...rule, eventId: "e" + index });
    send("rule-case", { ...rule, eventId: "e0" });
    expect(snap().ruleCandidate).toBeNull();
    send("rule-case", { ...rule, eventId: "e4" });
    expect(snap().ruleCandidate).toMatchObject({ examples: 5 });
    send("decide-rule", { ...rule, choice: "not_now" });
    expect(snap().ruleCandidate).toBeNull();
    send("rule-case", { ...rule, eventId: "e5" });
    expect(snap().ruleCandidate).toMatchObject({ examples: 6 });
    send("decide-rule", { ...rule, choice: "remember" });
    expect(snap().ruleCandidate).toBeNull();
    expect(send("rule-case", { ...rule, eventId: "e6" }).step).toEqual({
      appliedRule: true,
    });
    expect(snap().rules).toMatchObject([
      { state: "active", uses: 1, examples: 7 },
    ]);
    send("revoke-rule", { ruleId: snap().rules[0]!.id });
    expect(snap().rules[0]!.state).toBe("revoked");
  });
  it("never asks again after Never ask", () => {
    const { employer } = setup();
    const rule = { groupId: employer, situation: "s", resolution: "do x" };
    for (let index = 0; index < 5; index++)
      send("rule-case", { ...rule, eventId: "e" + index });
    send("decide-rule", { ...rule, choice: "never" });
    send("rule-case", { ...rule, eventId: "later" });
    expect(snap().ruleCandidate).toBeNull();
  });
});

describe("plans: approve plans, not clicks", () => {
  const items = Array.from({ length: 6 }, (_, index) => ({
    id: "s" + index,
    summary: "Story " + index,
    fields: { sprint: "Sprint 14", owner: null },
  }));
  function propose() {
    const { employer } = setup();
    const ticao = area(employer, "product", "TICAO");
    const planId = send("propose-plan", {
      groupId: null,
      workAreaId: ticao,
      planKind: "stories",
      destination: "ado",
      summary: "6 stories ready for Azure DevOps",
      items,
    }).ref!;
    return {
      employer,
      ticao,
      planId,
      plan: () => snap().plans.find((plan) => plan.id === planId)!,
    };
  }
  it("raises one approval item and publishes nothing before approval", () => {
    const { planId, plan, employer } = propose();
    expect(plan()).toMatchObject({ state: "proposed", groupId: employer });
    expect(snap().attention).toMatchObject([
      {
        kind: "approval",
        state: "open",
        ref: "plan:" + planId,
        title: "6 stories ready for Azure DevOps",
      },
    ]);
    expect(
      send("record-results", {
        planId,
        results: [{ id: "s0", state: "created" }],
      }).ok,
    ).toBe(false);
  });
  it("marking the attention item done does not approve the plan", () => {
    const { plan } = propose();
    const row = snap().attention[0]!;
    expect(
      send("resolve-attention", { attentionId: row.id, resolution: "done" }),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("does not approve it"),
    });
    send("resolve-attention", { attentionId: row.id, resolution: "snooze" });
    expect(snap().attention[0]!.state).toBe("snoozed");
    expect(plan().state).toBe("proposed");
    clock += 2 * 3_600_000;
    expect(snap().attention[0]!.state).toBe("open");
  });
  it("rejects an approval of something other than what is on screen", () => {
    const { planId, plan } = propose();
    const seen = plan().fingerprint;
    send("update-plan", {
      planId,
      items: [...items, { id: "s9", summary: "Late", fields: {} }],
    });
    expect(send("approve-plan", { planId, fingerprint: seen })).toMatchObject({
      ok: false,
      step: { reason: "changed" },
    });
    expect(plan().state).toBe("proposed");
    expect(
      send("approve-plan", { planId, fingerprint: plan().fingerprint }).ok,
    ).toBe(true);
    expect(plan().state).toBe("approved");
    expect(
      send("approve-plan", { planId, fingerprint: plan().fingerprint }).ok,
    ).toBe(false);
  });
  it("approval clears the item and starts publishing in Activity", () => {
    const { planId, plan } = propose();
    send("approve-plan", { planId, fingerprint: plan().fingerprint });
    expect(snap().attention[0]!.state).toBe("done");
    expect(snap().activity[0]).toMatchObject({
      state: "running",
      text: "Publishing 6 approved changes",
    });
  });
  it("reports partial writes per item, keeps the approval, and retries only the failures", () => {
    const { planId, plan } = propose();
    send("approve-plan", { planId, fingerprint: plan().fingerprint });
    const first = send("record-results", {
      planId,
      results: [
        ...["s0", "s1", "s2", "s3"].map((id, index) => ({
          id,
          state: "created",
          externalId: String(200 + index),
        })),
        { id: "s4", state: "failed" },
        { id: "s5", state: "failed" },
      ],
    });
    expect(first.step).toMatchObject({
      text: "4 created, 2 not created, nothing duplicated",
      button: "Retry the 2",
      retry: ["s4", "s5"],
      state: "partial",
    });
    expect(plan().state).toBe("partial");
    expect(
      snap().attention.find((item) => item.kind === "failure"),
    ).toMatchObject({
      state: "open",
      detail: "4 created, 2 not created, nothing duplicated",
      options: ["Retry the 2"],
    });
    expect(
      snap().activity.filter((row) => row.text.startsWith("Created #")).length,
    ).toBe(4);
    // A retry report cannot downgrade a confirmed creation.
    const second = send("record-results", {
      planId,
      results: [
        { id: "s0", state: "failed" },
        { id: "s4", state: "created", externalId: "204" },
        { id: "s5", state: "created", externalId: "205" },
      ],
    });
    expect(second.step).toMatchObject({
      created: 6,
      failed: 0,
      state: "published",
    });
    expect(
      snap().attention.find((item) => item.kind === "failure")!.state,
    ).toBe("done");
  });
  it("reconciles an uncertain write before any retry and rejects results outside the plan", () => {
    const { planId, plan } = propose();
    send("approve-plan", { planId, fingerprint: plan().fingerprint });
    expect(
      send("record-results", {
        planId,
        results: [{ id: "zz", state: "created" }],
      }).ok,
    ).toBe(false);
    expect(
      send("record-results", {
        planId,
        results: [{ id: "s0", state: "unknown" }],
      }).step,
    ).toMatchObject({
      button: "Check what was created",
      reconcileFirst: ["s0"],
      state: "failed",
    });
  });
  it("request changes closes the review without approving", () => {
    const { planId, plan } = propose();
    send("request-changes", { planId, note: "Split story 3" });
    expect(plan().state).toBe("changes_requested");
    expect(snap().attention[0]!.state).toBe("done");
    expect(
      send("approve-plan", { planId, fingerprint: plan().fingerprint }).ok,
    ).toBe(false);
    send("update-plan", { planId, items });
    expect(plan().state).toBe("proposed");
  });
});

describe("attention, activity and offers", () => {
  it("gives each delegated task its own Activity row and attention item (Q74)", () => {
    const { employer } = setup();
    const work = area(employer, "task", "Research");
    const running = send("activity", {
      groupId: null,
      workAreaId: work,
      text: "Competitor review",
      state: "running",
    }).ref!;
    expect(snap().attention).toEqual([]);
    send("activity", {
      groupId: null,
      workAreaId: work,
      text: "Competitor review",
      state: "finished",
      activityId: running,
    });
    send("activity", {
      groupId: null,
      workAreaId: work,
      text: "Read inbox",
      state: "failed",
    });
    expect(snap().attention.map((item) => [item.kind, item.title])).toEqual([
      ["result", "Competitor review"],
      ["failure", "Read inbox"],
    ]);
    expect(snap().activity).toHaveLength(2);
  });
  it("drafts only after the offer is accepted and never sends", () => {
    const { employer } = setup();
    const work = area(employer, "project", "E-Cabinet");
    const offer = send("attention", {
      attentionKind: "offer",
      groupId: null,
      workAreaId: work,
      title: "BRD approval is still unconfirmed",
      detail: "Draft a follow-up?",
    }).ref!;
    expect(snap().activity).toEqual([]);
    send("resolve-attention", { attentionId: offer, resolution: "accept" });
    expect(snap().activity).toMatchObject([
      { state: "running", text: "Drafting: BRD approval is still unconfirmed" },
    ]);
  });
  it("stores an answer and requires one", () => {
    const { employer } = setup();
    const question = send("attention", {
      attentionKind: "question",
      groupId: employer,
      workAreaId: null,
      title: "Which metric?",
      options: ["People", "Hours"],
    }).ref!;
    expect(
      send("resolve-attention", {
        attentionId: question,
        resolution: "answer",
        answer: " ",
      }).ok,
    ).toBe(false);
    send("resolve-attention", {
      attentionId: question,
      resolution: "answer",
      answer: "Hours",
    });
    expect(snap().attention[0]).toMatchObject({
      state: "done",
      answer: "Hours",
      options: ["People", "Hours"],
    });
  });
});

describe("tasks, projects and relations", () => {
  it("converts a task to a project in place, or remembers that it was declined (F4)", () => {
    const { employer } = setup();
    const task = area(employer, "task", "Arabic STT research");
    send("update-area", {
      areaId: task,
      patch: { milestones: 3, people: 4, steps: 6 },
    });
    send("convert-task", { areaId: task, convert: false });
    expect(snap().areas[0]).toMatchObject({
      type: "task",
      declinedShape: { milestones: 3, people: 4, steps: 6 },
    });
    send("message", {
      workAreaId: task,
      role: "you",
      text: "Earlier note",
      card: null,
    });
    send("convert-task", { areaId: task, convert: true });
    expect(snap().areas[0]).toMatchObject({
      id: task,
      type: "project",
      convertedFrom: "task",
      declinedShape: null,
    });
    expect(snap().messages).toMatchObject([
      { workAreaId: task, text: "Earlier note" },
    ]);
    expect(send("convert-task", { areaId: task, convert: true }).ok).toBe(
      false,
    );
  });
  it("links a delivery project to a product without merging them, and asks across groups", () => {
    const { employer, side } = setup();
    const product = area(employer, "product", "Platform");
    const project = area(employer, "project", "Client implementation");
    send("relate-areas", {
      fromId: project,
      toId: product,
      relation: "implements",
    });
    expect(snap().relations).toEqual([
      { fromId: project, toId: product, kind: "implements" },
    ]);
    const other = area(side, "product", "Side product");
    expect(
      send("relate-areas", {
        fromId: project,
        toId: other,
        relation: "implements",
      }),
    ).toMatchObject({
      ok: false,
      step: { reason: "cross_group" },
    });
  });
  it("records interest and context when a work area is opened", () => {
    const { employer } = setup();
    const task = area(employer, "task", "T");
    send("touch-area", { areaId: task, asked: true });
    expect(snap().areas[0]!.interest).toBe(1);
  });
});

describe("RFP tracking and handoff (F7)", () => {
  function rfp() {
    const { employer } = setup();
    const id = send("save-rfp", {
      groupId: employer,
      name: "Smart Inspection",
      client: "DMT",
      deadline: "2026-11-17T08:00:00Z",
    }).ref!;
    return { employer, id, row: () => snap().rfps[0]! };
  }
  it("captures the RFP as a tracking record", () => {
    const { id, row } = rfp();
    expect(row()).toMatchObject({
      id,
      client: "DMT",
      stage: "received",
      responseOwner: null,
    });
    expect(snap().areas[0]).toMatchObject({
      type: "rfp",
      dueAt: "2026-11-17T08:00:00Z",
    });
    send("save-rfp", {
      areaId: id,
      groupId: null,
      name: "Smart Inspection",
      client: "DMT",
      responseOwner: "Sara",
    });
    expect(row().responseOwner).toBe("Sara");
  });
  it("records a loss with its reason and keeps unknown reasons unknown", () => {
    const { id, row } = rfp();
    send("move-rfp", { areaId: id, stage: "lost" });
    expect(row()).toMatchObject({ stage: "lost", lossReason: null });
    send("move-rfp", { areaId: id, stage: "lost", lossReason: "Price" });
    expect(row().lossReason).toBe("Price");
    expect(send("handoff-rfp", { areaId: id }).ok).toBe(false);
  });
  it("waits for the signed proposal, then the approved BRD", () => {
    const { id, row } = rfp();
    send("move-rfp", { areaId: id, stage: "won" });
    expect(send("handoff-rfp", { areaId: id })).toMatchObject({
      ok: false,
      step: { pending: "signature" },
    });
    send("rfp-readiness", {
      areaId: id,
      proposalSigned: true,
      brdApproved: false,
    });
    expect(send("handoff-rfp", { areaId: id })).toMatchObject({
      ok: false,
      step: { pending: "brd" },
    });
    expect(
      send("move-rfp", { areaId: id, stage: "handed_to_delivery" }).ok,
    ).toBe(false);
    expect(row().stage).toBe("won");
    expect(snap().areas).toHaveLength(1);
  });
  it("creates one linked delivery project and keeps the RFP", () => {
    const { id, row, employer } = rfp();
    send("move-rfp", { areaId: id, stage: "won" });
    send("rfp-readiness", {
      areaId: id,
      proposalSigned: true,
      brdApproved: true,
    });
    const project = send("handoff-rfp", { areaId: id }).ref!;
    expect(row()).toMatchObject({
      stage: "handed_to_delivery",
      deliveryProjectId: project,
    });
    expect(
      snap().areas.map((item) => [
        item.type,
        item.name,
        item.groupId === employer,
      ]),
    ).toEqual([
      ["rfp", "Smart Inspection", true],
      ["project", "Smart Inspection delivery", true],
    ]);
    expect(snap().relations).toEqual([
      { fromId: id, toId: project, kind: "handoff" },
    ]);
    expect(send("handoff-rfp", { areaId: id })).toMatchObject({
      ref: project,
      step: { reused: true },
    });
    expect(snap().areas).toHaveLength(2);
  });
});

describe("roadmap (Q63): committed changes need approval", () => {
  function roadmap() {
    const { employer } = setup();
    const product = area(employer, "product", "Platform");
    const add = (title: string) =>
      send("save-roadmap-item", {
        workAreaId: product,
        title,
        horizon: "now",
        reach: null,
        impact: null,
        confidence: null,
        effort: null,
      }).ref!;
    return { product, a: add("A"), b: add("B") };
  }
  const order = () =>
    snap()
      .roadmap.map((item) => `${item.title}:${item.horizon}:${item.position}`)
      .sort();
  it("applies a draft move at once", () => {
    const { b } = roadmap();
    expect(
      send("move-roadmap-item", { itemId: b, horizon: "now", index: 0 }).step,
    ).toBeNull();
    expect(order()).toEqual(["A:now:1", "B:now:0"]);
    expect(snap().plans).toEqual([]);
  });
  it("turns a committed move into a plan, and applies it only on approval", () => {
    const { a } = roadmap();
    store.commitRoadmap([a]);
    const result = send("move-roadmap-item", {
      itemId: a,
      horizon: "later",
      index: 0,
    });
    expect(result.step).toMatchObject({ needsApproval: true });
    expect(order()).toEqual(["A:now:0", "B:now:1"]);
    expect(
      send("save-roadmap-item", {
        itemId: a,
        workAreaId: snap().roadmap[0]!.workAreaId,
        title: "A2",
        horizon: "next",
        reach: null,
        impact: null,
        confidence: null,
        effort: null,
      }).ok,
    ).toBe(false);
    const plan = snap().plans[0]!;
    expect(plan).toMatchObject({
      kind: "roadmap",
      destination: "amun",
      state: "proposed",
    });
    send("approve-plan", { planId: plan.id, fingerprint: plan.fingerprint });
    expect(order()).toEqual(["A:later:0", "B:now:1"]);
    expect(snap().plans[0]!.state).toBe("published");
    expect(snap().roadmap.find((item) => item.id === a)!.committed).toBe(true);
    expect(snap().decisions).toMatchObject([
      { outcome: "Approved", decidedBy: "you" },
    ]);
  });
});

describe("sprints, scope, library, decisions, council and agents", () => {
  it("keeps a draft sprint editable and capacity unknown until someone sets it", () => {
    const { employer } = setup();
    const work = area(employer, "product", "TICAO");
    const base = {
      workAreaId: work,
      name: "Sprint 15",
      start: "2026-11-23T00:00:00Z",
      end: "2026-12-06T00:00:00Z",
      stories: [{ id: "1", title: "A", points: 5, owner: null }],
      out: [{ id: "2", title: "B", points: 3, owner: null }],
    };
    const id = send("save-sprint", base).ref!;
    expect(snap().sprints[0]).toMatchObject({
      draft: true,
      capacity: null,
      total: 1,
    });
    send("move-sprint-story", {
      sprintId: id,
      storyId: "2",
      list: "stories",
      owner: "Mohammed",
    });
    expect(snap().sprints[0]).toMatchObject({ total: 2, out: [] });
    send("save-sprint", { ...base, sprintId: id, draft: false });
    expect(
      send("move-sprint-story", { sprintId: id, storyId: "1", list: "out" }).ok,
    ).toBe(false);
    expect(
      send("save-sprint", { ...base, end: "2026-11-01T00:00:00Z" }).ok,
    ).toBe(false);
    send("calendar-exception", { date: "2026-12-02", label: "National Day" });
    expect(snap().calendar).toEqual([
      { date: "2026-12-02", label: "National Day" },
    ]);
  });
  it("records a scope exception honestly in Decisions (Q77)", () => {
    const { employer } = setup();
    const project = area(employer, "project", "Inspection delivery");
    expect(
      send("scope-answer", {
        workAreaId: project,
        item: "Reporting feature",
        answer: "add_anyway",
      }).step,
    ).toEqual({
      tag: "Exception · no CR",
    });
    expect(snap().decisions).toMatchObject([
      {
        source: "exception",
        decidedBy: "you",
        outcome:
          "Added as an exception · no approved change request · deadline unchanged",
        affected: ["Reporting feature"],
      },
    ]);
    expect(
      send("scope-answer", {
        workAreaId: project,
        item: "Other",
        answer: "keep_out",
      }).step,
    ).toEqual({ tag: null });
    expect(snap().decisions).toHaveLength(1);
  });
  it("files outputs in the Library within their own group", () => {
    const { employer, side } = setup();
    const work = area(employer, "product", "MARC");
    const id = send("save-output", {
      groupId: employer,
      type: "prd",
      title: "MARC PRD",
      body: "…",
      workAreaIds: [work],
    }).ref!;
    send("save-output", {
      outputId: id,
      groupId: employer,
      type: "prd",
      title: "MARC PRD",
      status: "Approved",
      workAreaIds: [work],
    });
    expect(snap().library).toMatchObject([
      { id, section: "output", status: "Approved", workAreaIds: [work] },
    ]);
    const elsewhere = area(side, "task", "x");
    expect(
      send("save-output", {
        groupId: employer,
        type: "prd",
        title: "t",
        workAreaIds: [elsewhere],
      }).ok,
    ).toBe(false);
  });
  it("sends a Council report to the Library and its recommendation to Decisions, once", () => {
    const { employer } = setup();
    const work = area(employer, "product", "MARC");
    const session = send("council-session", {
      decision: "Raise prices",
      groupId: null,
      workAreaId: work,
      mode: "quick",
      state: "running",
    }).ref!;
    expect(snap().library).toEqual([]);
    const finish = {
      sessionId: session,
      decision: "Raise prices",
      groupId: null,
      workAreaId: work,
      mode: "quick",
      state: "finished",
      recommendation: "Raise by 10% for new customers",
    };
    send("council-session", finish);
    send("council-session", finish);
    expect(snap().library).toMatchObject([
      {
        type: "council_report",
        title: "Council · Raise prices",
        status: "Advisory",
      },
    ]);
    expect(snap().decisions).toMatchObject([
      {
        source: "council",
        outcome: null,
        options: ["Raise by 10% for new customers"],
      },
    ]);
    // A verdict changes nothing else.
    expect(snap().roadmap).toEqual([]);
    expect(snap().plans).toEqual([]);
    expect(snap().council[0]).toMatchObject({
      state: "finished",
      groupId: employer,
    });
  });
  it("adds an agent from a description and can switch it off", () => {
    setup();
    const id = send("add-agent", {
      description: "a pricing analyst who reads competitor sites",
    }).ref!;
    const agent = (snap: WorkSnapshot) =>
      snap.agents.find((item) => item.id === id)!;
    expect(agent(snap())).toMatchObject({
      role: "Pricing analyst",
      kind: "always_on",
      launcherId: "firstmate",
    });
    expect(send("add-agent", { description: "pricing analyst" }).ok).toBe(
      false,
    );
    send("toggle-agent", { agentId: id, enabled: false });
    expect(agent(snap()).enabled).toBe(false);
    send("toggle-agent", { agentId: "firstmate", enabled: false });
    expect(snap().agents[0]!.enabled).toBe(true);
    expect(
      send("add-agent", { description: "temp helper", always: false }).ok,
    ).toBe(true);
  });
  it("records decisions with who decided and when", () => {
    const { employer } = setup();
    const id = send("record-decision", {
      groupId: employer,
      workAreaId: null,
      what: "Pick a vendor",
      options: ["A", "B"],
    }).ref!;
    expect(snap().decisions[0]).toMatchObject({
      outcome: null,
      decidedAt: null,
      decidedBy: null,
    });
    send("record-decision", {
      decisionId: id,
      groupId: employer,
      workAreaId: null,
      what: "Pick a vendor",
      outcome: "A",
      decidedBy: "client",
    });
    expect(snap().decisions[0]).toMatchObject({
      outcome: "A",
      decidedBy: "client",
      decidedAt: expect.any(String),
    });
  });
  it("marks when the user was last here", () => {
    setup();
    send("seen");
    expect(snap().setup.lastSeenAt).not.toBeNull();
  });
});

describe("findings to approved work (F3)", () => {
  function shared() {
    const { employer, side } = setup();
    const alpha = area(employer, "product", "Alpha");
    const beta = area(employer, "project", "Beta");
    const record = send("save-record", {
      groupId: employer,
      type: "interview",
      title: "Customer call",
    }).ref!;
    send("link-record", {
      recordId: record,
      choice: "link",
      workAreaIds: [alpha, beta],
    });
    const finding = send("save-finding", {
      recordId: record,
      text: "Bulk upload",
      workAreaIds: [alpha, beta],
    }).ref!;
    const decisions = () =>
      Object.fromEntries(
        snap()
          .findings.find((item) => item.id === finding)!
          .decisions.map((decision) => [decision.workAreaId, decision]),
      );
    return { employer, side, alpha, beta, record, finding, decisions };
  }
  it("proposes per work area with provenance and commits nothing", () => {
    const { alpha, beta, decisions } = shared();
    expect(decisions()[alpha]!.state).toBe("proposed");
    expect(decisions()[beta]!.state).toBe("proposed");
    expect(
      snap().attention.filter((item) => item.kind === "approval"),
    ).toHaveLength(2);
    const plan = snap().plans.find((item) => item.workAreaId === alpha)!;
    expect(plan).toMatchObject({ destination: "notion", state: "proposed" });
    expect(plan.items[0]!.fields).toEqual({ source: "Customer call" });
    // The delivery project routes to Azure DevOps; the product does not.
    expect(
      snap().plans.find((item) => item.workAreaId === beta)!.destination,
    ).toBe("ado");
    expect(snap().roadmap).toEqual([]);
  });
  it("keeps one source with separate decisions, and marks work written only when confirmed", () => {
    const { alpha, beta, finding, decisions } = shared();
    const approve = snap().plans.find((item) => item.workAreaId === alpha)!;
    send("approve-plan", {
      planId: approve.id,
      fingerprint: approve.fingerprint,
    });
    send("request-changes", { planId: decisions()[beta]!.planId });
    expect(decisions()[alpha]!.state).toBe("approved");
    expect(decisions()[beta]!.state).toBe("rejected");
    send("record-results", {
      planId: approve.id,
      results: [{ id: finding, state: "failed" }],
    });
    // The approval is kept; the work is not marked complete.
    expect(decisions()[alpha]!.state).toBe("write_failed");
    send("record-results", {
      planId: approve.id,
      results: [{ id: finding, state: "created", externalId: "311" }],
    });
    expect(decisions()[alpha]!.state).toBe("written");
    expect(snap().records).toHaveLength(1);
  });
  it("defers a finding without a commitment and blocks other groups", () => {
    const { alpha, side, record, finding, decisions } = shared();
    send("defer-finding", { findingId: finding, workAreaId: alpha });
    expect(decisions()[alpha]!.state).toBe("deferred");
    const elsewhere = area(side, "product", "Side product");
    expect(
      send("save-finding", {
        recordId: record,
        text: "x",
        workAreaIds: [elsewhere],
      }),
    ).toMatchObject({
      ok: false,
      step: { reason: "cross_group" },
    });
    expect(
      send("defer-finding", { findingId: finding, workAreaId: elsewhere }).ok,
    ).toBe(false);
  });
});

describe("external changes (F9)", () => {
  it("records the change and a flag, and raises attention only for commitments", () => {
    const { employer } = setup();
    const work = area(employer, "product", "TICAO");
    const sprint = send("save-sprint", {
      workAreaId: work,
      name: "Sprint 14",
      start: "2026-11-09T00:00:00Z",
      end: "2026-11-22T00:00:00Z",
      draft: false,
    }).ref!;
    const change = {
      workAreaId: work,
      sprintId: sprint,
      itemId: "#124",
      field: "Assignee",
      before: "Sara",
      after: "Mohammed",
    };
    expect(
      send("external-change", { ...change, affectsCommitment: false }).step,
    ).toEqual({
      flag: "Changed in ADO",
      attention: false,
    });
    expect(snap().sprints[0]!.changedInAdo).toBe(true);
    expect(snap().activity[0]!.text).toBe(
      "#124: Assignee changed in Azure DevOps: Sara → Mohammed",
    );
    expect(snap().attention).toEqual([]);
    send("external-change", {
      ...change,
      field: "Sprint",
      before: "14",
      after: "15",
      affectsCommitment: true,
    });
    expect(snap().attention).toMatchObject([
      {
        kind: "risk",
        title: "#124 changed in Azure DevOps",
        options: ["Acknowledge"],
      },
    ]);
    // Acknowledging closes the item; nothing is reverted.
    send("resolve-attention", {
      attentionId: snap().attention[0]!.id,
      resolution: "done",
    });
    expect(snap().attention[0]!.state).toBe("done");
    expect(snap().plans).toEqual([]);
  });
});

describe("memory updates (F10)", () => {
  const claim = (
    groupId: string,
    value: string,
    confirmed: boolean,
    source = "Email from Sara",
  ) => ({
    groupId,
    key: "reports-to",
    value,
    source,
    observedAt: "2026-11-10",
    confirmed,
  });
  const rows = () =>
    db
      .prepare(
        "SELECT value,state,confirmed FROM memory_claims ORDER BY created_at,rowid",
      )
      .all();
  it("records new facts and keeps history when a fact changes", () => {
    const { employer } = setup();
    expect(send("record-claim", claim(employer, "Layla", true)).step).toEqual({
      step: "record",
    });
    expect(send("record-claim", claim(employer, "Layla", false)).step).toEqual({
      step: "unchanged",
    });
    expect(send("record-claim", claim(employer, "Omar", true)).step).toEqual({
      step: "record",
    });
    expect(rows()).toEqual([
      { value: "Layla", state: "superseded", confirmed: 1 },
      { value: "Omar", state: "current", confirmed: 1 },
    ]);
    // Never claimed as saved to the memory home until it actually is.
    expect(snap().memory).toEqual({ unsynced: 1, disputed: 0 });
  });
  it("asks, citing the source, when evidence contradicts what the user confirmed", () => {
    const { employer } = setup();
    send("record-claim", claim(employer, "Layla", true));
    expect(send("record-claim", claim(employer, "Omar", false)).step).toEqual({
      step: "ask",
    });
    expect(snap().attention).toMatchObject([
      {
        kind: "question",
        title:
          'Email from Sara (2026-11-10) says "Omar". You told me "Layla". Which is right?',
        options: ["Omar", "Layla"],
      },
    ]);
    expect(snap().memory.disputed).toBe(1);
    expect(rows().map((row) => (row as { state: string }).state)).toEqual([
      "current",
      "disputed",
    ]);
  });
  it("settles the discrepancy either way from the Island answer", () => {
    const { employer, side } = setup();
    send("record-claim", claim(employer, "Layla", true));
    send("record-claim", claim(employer, "Omar", false));
    send("resolve-attention", {
      attentionId: snap().attention[0]!.id,
      resolution: "answer",
      answer: "Omar",
    });
    expect(rows()).toEqual([
      { value: "Layla", state: "superseded", confirmed: 1 },
      { value: "Omar", state: "current", confirmed: 1 },
    ]);
    send("record-claim", claim(employer, "Zed", false, "Old sheet"));
    send("resolve-claim", {
      attentionId: snap().attention.at(-1)!.id,
      keep: "current",
    });
    expect(rows().at(-1)).toEqual({
      value: "Zed",
      state: "superseded",
      confirmed: 0,
    });
    expect(snap().memory.disputed).toBe(0);
    expect(
      send("resolve-claim", {
        attentionId: snap().attention.at(-1)!.id,
        keep: "current",
      }).ok,
    ).toBe(false);
    // Facts are scoped to their group.
    expect(
      send("record-claim", claim(side, "Someone else", false)).step,
    ).toEqual({ step: "record" });
  });
});
