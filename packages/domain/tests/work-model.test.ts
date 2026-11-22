import { describe, expect, it } from "vitest";
import {
  asksForNewWork,
  newWorkNamed,
  routeNewWork,
  sameWorkName,
  statedDueDate,
  statedPriority,
  classifyMaterial,
  inferWorkArea,
  intake,
  linkRecord,
  nameFromRequest,
  rfpDetails,
  rfpFromRequest,
  needsLinking,
  type SupportingRecord,
  type WorkArea,
} from "../src/work/model.ts";
import { adoSprintsLine } from "../src/work/planning.ts";
import {
  appliedRule,
  approvalSurface,
  approveLabel,
  planNoun,
  authority,
  changeSinceApproval,
  gateFor,
  permissionChanges,
  planFingerprint,
  ruleCandidate,
  retryOutcome,
  writeSummary,
  type LearnedRule,
  type Plan,
  type RuleCase,
} from "../src/work/permissions.ts";

const area = (
  id: string,
  name: string,
  groupId: string | null = "employer",
): WorkArea => ({
  id,
  name,
  groupId,
  type: "product",
  status: "active",
});
const areas = [
  area("a", "Agentic Platform"),
  area("b", "Smart Inspection"),
  area("c", "Supplier Research", "side"),
];
const groups = [
  { id: "employer", name: "Employer" },
  { id: "side", name: "Side business" },
];

describe("classifyMaterial (decision table §3)", () => {
  it.each([
    [
      "Here is an interview about onboarding friction",
      { kind: "record", type: "interview" },
    ],
    ["My boss wants billability to reach 90% target", { kind: "objective" }],
    ["OKR: grow adoption", { kind: "objective" }],
    ["New RFP from the ministry", { kind: "work", type: "rfp" }],
    ["Client delivery with an approved BRD", { kind: "work", type: "project" }],
    ["Plan the product roadmap", { kind: "work", type: "product" }],
    ["An idea: what if we bulk upload", { kind: "record", type: "idea" }],
    [
      "Users complain about login friction",
      { kind: "record", type: "problem" },
    ],
    ["A reading for reference", { kind: "record", type: "document" }],
    ["Fix bug 124 in the story", { kind: "execution" }],
    ["Book the venue for Thursday", { kind: "work", type: "task" }],
  ])("%s", (text, expected) => {
    expect(classifyMaterial({ text })).toEqual(expected);
  });
  it("keeps a bare upload as a document and flags unreadable input", () => {
    expect(classifyMaterial({ text: "", fileNames: ["a.pdf"] })).toEqual({
      kind: "record",
      type: "document",
    });
    expect(classifyMaterial({ text: "" })).toEqual({ kind: "unreadable" });
    expect(classifyMaterial({ text: "x", readable: false })).toEqual({
      kind: "unreadable",
    });
  });
});

describe("inferWorkArea (Q30)", () => {
  it("is confident on a full, unique name match inside the group", () => {
    const result = inferWorkArea(
      "update the agentic platform plan",
      areas,
      "employer",
    );
    expect(result.confident?.id).toBe("a");
  });
  it("offers options instead of guessing on a partial match", () => {
    const result = inferWorkArea("the platform work", areas, "employer");
    expect(result.confident).toBeNull();
    expect(result.options.map((item) => item.id)).toEqual(["a"]);
  });
  it("never proposes an area from another group", () => {
    const result = inferWorkArea("supplier research", areas, "employer");
    expect(result.options).toEqual([]);
  });
  it("is not confident when two areas match fully", () => {
    const twins = [area("x", "Portal"), area("y", "Portal")];
    expect(inferWorkArea("portal", twins, "employer").confident).toBeNull();
  });
});

describe("intake (F1)", () => {
  const base = { groups, areas, groupId: "employer" as string | null };
  it("asks the group first when it is unknown", () => {
    expect(intake({ ...base, groupId: null, text: "an interview" })).toEqual({
      step: "ask_group",
    });
  });
  it("uses the only group without asking", () => {
    expect(
      intake({
        ...base,
        groupId: null,
        groups: [groups[0]!],
        text: "an interview",
      }),
    ).toMatchObject({ step: "save_record", type: "interview" });
  });
  it("saves a supporting record and asks where it belongs", () => {
    expect(intake({ ...base, text: "interview notes" })).toEqual({
      step: "save_record",
      type: "interview",
      ask: "link",
    });
  });
  it("routes objectives and execution items to their own flows", () => {
    expect(intake({ ...base, text: "reach 90% target" }).step).toBe(
      "define_objective",
    );
    expect(intake({ ...base, text: "a bug ticket" }).step).toBe(
      "route_execution",
    );
  });
  it("files confident work and offers a card otherwise", () => {
    expect(
      intake({ ...base, text: "smart inspection product roadmap" }),
    ).toMatchObject({
      step: "file_work",
      area: { id: "b" },
    });
    expect(intake({ ...base, text: "start a new product" })).toMatchObject({
      step: "choose_work",
      type: "product",
      options: [],
    });
  });
  it("routes reminders before asking the group or creating anything", () => {
    for (const text of [
      "Remind me in 2 minutes to review the QA PRD.",
      "please remind me to call Sam tomorrow",
      "Could you remind me at 5pm to send the deck?",
      "Set a reminder for Monday",
      "set up a reminder to review the PRD",
      "Reminder: review the QA PRD",
      "remind me on Friday",
    ]) {
      expect(intake({ ...base, groupId: null, text })).toEqual({
        step: "reminder",
        intent: "add",
      });
      expect(intake({ ...base, text }).step).toBe("reminder");
    }
  });
  it("still files an ordinary review task as work", () => {
    expect(intake({ ...base, text: "review the QA PRD" }).step).not.toBe(
      "reminder",
    );
    expect(
      intake({ ...base, text: "I need a reminder system product" }).step,
    ).not.toBe("reminder");
  });
  it("keeps the source and explains when unreadable", () => {
    expect(intake({ ...base, text: "", readable: false })).toEqual({
      step: "unreadable",
    });
  });
});

describe("linkRecord (F2, UC02–03)", () => {
  const record = { groupId: "employer", links: [] as string[] };
  it("links now to several areas in the same group", () => {
    expect(
      linkRecord(record, { choice: "link", workAreaIds: ["a", "b"] }, areas),
    ).toEqual({
      ok: true,
      linkage: "linked",
      links: ["a", "b"],
      followUp: false,
    });
  });
  it("link later keeps an open linking item", () => {
    expect(linkRecord(record, { choice: "later" }, areas)).toMatchObject({
      linkage: "link_later",
      followUp: true,
    });
  });
  it("intentionally unlinked has no follow-up", () => {
    expect(linkRecord(record, { choice: "never" }, areas)).toMatchObject({
      linkage: "unlinked",
      followUp: false,
    });
  });
  it("no answer stays unresolved, never 'unlinked'", () => {
    expect(linkRecord(record, { choice: "none" }, areas)).toMatchObject({
      linkage: "unresolved",
    });
    expect(
      linkRecord({ ...record, links: ["a"] }, { choice: "none" }, areas),
    ).toMatchObject({ linkage: "linked" });
  });
  it("asks before linking across groups and honours a grant", () => {
    expect(
      linkRecord(record, { choice: "link", workAreaIds: ["c"] }, areas),
    ).toEqual({
      ok: false,
      reason: "cross_group",
      workAreaIds: ["c"],
    });
    expect(
      linkRecord(record, { choice: "link", workAreaIds: ["c"] }, areas, ["c"]),
    ).toMatchObject({ ok: true, links: ["c"] });
  });
  it("rejects empty and unknown targets", () => {
    expect(
      linkRecord(record, { choice: "link", workAreaIds: [] }, areas),
    ).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(
      linkRecord(record, { choice: "link", workAreaIds: ["zz"] }, areas),
    ).toEqual({
      ok: false,
      reason: "unknown_area",
    });
  });
});

describe("needsLinking (Q79)", () => {
  const record = (
    id: number,
    linkage: SupportingRecord["linkage"],
  ): SupportingRecord => ({
    id: String(id),
    groupId: "employer",
    type: "idea",
    title: "t",
    linkage,
    links: [],
  });
  it("lists link-later and unresolved, never intentionally unlinked", () => {
    const result = needsLinking([
      record(1, "link_later"),
      record(2, "unlinked"),
      record(3, "unresolved"),
      record(4, "linked"),
    ]);
    expect(result.pending.map((item) => item.id)).toEqual(["1", "3"]);
    expect(result.homeLine).toBeNull();
  });
  it("adds one Home line only above ten", () => {
    const many = Array.from({ length: 11 }, (_, index) =>
      record(index, "link_later"),
    );
    expect(needsLinking(many).homeLine).toBe(
      "11 records are waiting to be linked",
    );
  });
});

describe("gates and authority (§8)", () => {
  const permission = {
    id: "p",
    groupId: "employer",
    destination: "notion",
    action: "create" as const,
    revokedAt: null,
  };
  it("always gates Azure DevOps writes", () => {
    const op = {
      action: "create" as const,
      destination: "ado",
      groupId: "employer",
    };
    expect(gateFor(op)).toBe("ado_write");
    expect(
      authority(op, {
        instructed: true,
        permissions: [{ ...permission, destination: "ado" }],
      }),
    ).toEqual({ allowed: false, ask: "gate", gate: "ado_write" });
  });
  it("gates backlog additions and committed roadmap changes", () => {
    expect(
      gateFor({ action: "backlog_add", destination: "amun", groupId: "g" }),
    ).toBe("backlog_or_roadmap");
    expect(
      gateFor({ action: "roadmap_commit", destination: "amun", groupId: "g" }),
    ).toBe("backlog_or_roadmap");
  });
  it("gates cross-group use before anything else", () => {
    expect(
      gateFor({
        action: "use_context",
        destination: "amun",
        groupId: "side",
        sourceGroupId: "employer",
      }),
    ).toBe("cross_group");
    expect(
      gateFor({
        action: "use_context",
        destination: "amun",
        groupId: "side",
        sourceGroupId: "side",
      }),
    ).toBeNull();
  });
  it("lets preparing and drafting for ADO run freely", () => {
    expect(
      gateFor({ action: "prepare", destination: "ado", groupId: "g" }),
    ).toBeNull();
    expect(
      gateFor({ action: "draft", destination: "ado", groupId: "g" }),
    ).toBeNull();
    expect(
      authority({ action: "prepare", destination: "ado", groupId: "g" }),
    ).toEqual({ allowed: true, basis: "preparing" });
  });
  it("uses an instruction, then a matching standing permission, else asks", () => {
    const op = {
      action: "create" as const,
      destination: "notion",
      groupId: "employer",
    };
    expect(authority(op, { permissions: [], instructed: true })).toEqual({
      allowed: true,
      basis: "instruction",
    });
    expect(authority(op, { permissions: [permission] })).toEqual({
      allowed: true,
      basis: "standing",
    });
    expect(
      authority(op, {
        permissions: [{ ...permission, revokedAt: "2026-11-01" }],
      }),
    ).toEqual({ allowed: false, ask: "approval" });
    expect(
      authority({ ...op, groupId: "side" }, { permissions: [permission] }),
    ).toEqual({
      allowed: false,
      ask: "approval",
    });
    expect(authority(op)).toEqual({ allowed: false, ask: "approval" });
  });
});

describe("approve plans, not clicks", () => {
  const plan: Plan = {
    destination: "ado",
    items: [
      { id: "1", summary: "A", fields: { sprint: "14", owner: null } },
      { id: "2", summary: "B", fields: { owner: "M", sprint: "14" } },
    ],
  };
  it("fingerprints independently of item and field order", () => {
    const reordered: Plan = {
      destination: "ado",
      items: [
        { id: "2", summary: "B", fields: { sprint: "14", owner: "M" } },
        { id: "1", summary: "A", fields: { owner: null, sprint: "14" } },
      ],
    };
    expect(planFingerprint(reordered)).toBe(planFingerprint(plan));
  });
  it("covers the approved batch and a subset of it", () => {
    expect(changeSinceApproval(plan, plan)).toEqual({ changed: false });
    expect(
      changeSinceApproval(plan, { ...plan, items: [plan.items[0]!] }),
    ).toEqual({ changed: false });
  });
  it("asks again for an added or altered item", () => {
    const altered = {
      ...plan,
      items: [
        plan.items[0]!,
        { ...plan.items[1]!, fields: { owner: "S", sprint: "14" } },
      ],
    };
    expect(changeSinceApproval(plan, altered)).toEqual({
      changed: true,
      reason: "1 item has changed since you opened this review.",
      outside: ["2"],
    });
    const added = {
      ...plan,
      items: [
        ...plan.items,
        { id: "3", summary: "C", fields: {} },
        { id: "4", summary: "D", fields: {} },
      ],
    };
    expect(changeSinceApproval(plan, added)).toMatchObject({
      changed: true,
      reason: "2 items have changed since you opened this review.",
    });
  });
  it("asks again when the destination changes", () => {
    expect(
      changeSinceApproval(plan, { ...plan, destination: "notion" }),
    ).toMatchObject({
      changed: true,
      outside: ["1", "2"],
    });
  });
  it("picks the tray for small batches and the pane for plans", () => {
    expect(approvalSurface({ kind: "stories", count: 6 })).toBe("tray");
    expect(approvalSurface({ kind: "stories", count: 30 })).toBe("pane");
    expect(approvalSurface({ kind: "sprint_plan", count: 3 })).toBe("pane");
    expect(approvalSurface({ kind: "roadmap", count: 1 })).toBe("pane");
  });
  it("names the approval by what it covers", () => {
    expect(approveLabel(6)).toBe("Approve and publish 6 stories");
    expect(approveLabel(1)).toBe("Approve and publish 1 story");
    expect(approveLabel(2, "edit")).toBe("Approve and publish 2 edits");
  });
  it("names a Task a task, a mix items, and an unknown type nothing", () => {
    const fields = (type?: string) => (type ? { type } : {});
    expect(planNoun([{ kind: "Task", fields: {} }])).toBe("task");
    expect(planNoun([{ fields: fields("Product Backlog Item") }])).toBe(
      "product backlog item",
    );
    expect(
      planNoun([
        { kind: "Task", fields: {} },
        { kind: "Bug", fields: {} },
      ]),
    ).toBe("item");
    expect(planNoun([{ fields: {} }])).toBeNull();
    expect(approveLabel(2, "item")).toBe("Approve and publish 2 items");
  });
  it("says when a team's only sprints are over", () => {
    const sprint = {
      id: "1",
      name: "Sprint 5",
      start: "2021-03-01",
      finish: "2021-03-14",
    };
    const now = Date.parse("2026-11-15");
    expect(adoSprintsLine([sprint], "POCs Team", now)).toBe(
      "POCs Team has no current or upcoming sprints. Its latest was Sprint 5 (ended 14 Mar 2021).",
    );
    expect(
      adoSprintsLine(
        [
          sprint,
          { ...sprint, id: "2", name: "Sprint 6", finish: "2026-12-01" },
        ],
        "POCs Team",
        now,
      ),
    ).toBe("Showing 2 sprints for POCs Team.");
  });
});

describe("retryOutcome", () => {
  it("says in one line what the retry did", () => {
    expect(retryOutcome([{ summary: "A", state: "created" }], null)).toBe(
      "Retried the 1 item that was not published: 1 created.",
    );
    expect(
      retryOutcome([{ summary: "A", state: "failed" }], "No such type."),
    ).toBe(
      "Retried the 1 item that was not published: 0 created, 1 still not created. No such type.",
    );
  });
});

describe("writeSummary (partial writes)", () => {
  it("reports per-item outcomes and offers to retry only the failures", () => {
    const summary = writeSummary([
      ...["1", "2", "3", "4"].map((id) => ({ id, state: "created" as const })),
      { id: "5", state: "failed" as const },
      { id: "6", state: "failed" as const },
    ]);
    expect(summary.text).toBe("4 created, 2 not created, nothing duplicated");
    expect(summary.button).toBe("Retry the 2");
    expect(summary.retry).toEqual(["5", "6"]);
  });
  it("says a linked item already existed instead of counting it as created", () => {
    const summary = writeSummary([
      { id: "1", state: "created" },
      { id: "2", state: "created", linked: true },
    ]);
    expect(summary.text).toBe(
      "1 created, 0 not created, 1 already existed (linked, not created), nothing duplicated",
    );
  });
  it("reconciles uncertain writes before any retry", () => {
    const summary = writeSummary([
      { id: "1", state: "unknown" },
      { id: "2", state: "failed" },
    ]);
    expect(summary.button).toBe("Check what was created");
    expect(summary.reconcileFirst).toEqual(["1"]);
    expect(summary.text).toContain("1 being checked");
  });
  it("has no button when everything was created", () => {
    expect(writeSummary([{ id: "1", state: "created" }]).button).toBeNull();
  });
});

describe("learned rules (Q76, UC22)", () => {
  const cases = (count: number, extra: Partial<RuleCase> = {}): RuleCase[] =>
    Array.from({ length: count }, (_, index) => ({
      situation: "sheet-vs-project",
      groupId: "employer",
      resolution: "use the approved sheet",
      eventId: "e" + index,
      ...extra,
    }));
  it("proposes once after the fifth independent case", () => {
    expect(ruleCandidate(cases(4), [])).toBeNull();
    expect(ruleCandidate(cases(5), [])).toMatchObject({
      examples: 5,
      ask: "This has happened 5 times. Should I use the approved sheet next time?",
      choices: ["Yes, remember", "Not now", "Never ask"],
    });
  });
  it("does not count repeated copies of one event", () => {
    expect(ruleCandidate(cases(9, { eventId: "same" }), [])).toBeNull();
  });
  it("stays quiet once active or after Never ask, but not after Not now", () => {
    const rule = (state: LearnedRule["state"]): LearnedRule => ({
      id: "r",
      groupId: "employer",
      situation: "sheet-vs-project",
      resolution: "use the approved sheet",
      state,
    });
    expect(ruleCandidate(cases(5), [rule("active")])).toBeNull();
    expect(ruleCandidate(cases(5), [rule("never")])).toBeNull();
    expect(ruleCandidate(cases(5), [rule("declined")])).not.toBeNull();
    expect(ruleCandidate(cases(5), [rule("revoked")])).not.toBeNull();
  });
  it("applies only inside its own group and situation", () => {
    const rules: LearnedRule[] = [
      {
        id: "r",
        groupId: "employer",
        situation: "sheet-vs-project",
        resolution: "x",
        state: "active",
      },
    ];
    expect(appliedRule(rules, "employer", "sheet-vs-project")?.id).toBe("r");
    expect(appliedRule(rules, "side", "sheet-vs-project")).toBeNull();
    expect(appliedRule(rules, "employer", "other")).toBeNull();
  });
});

describe("nameFromRequest", () => {
  it.each([
    ["Create a product called Agentic Platform", "Agentic Platform"],
    ["Start a task: Book the venue.", "Book the venue"],
    ["Track an RFP from DMT Smart Inspection", "DMT Smart Inspection"],
    ['Start a new project named "E-Cabinet"', "E-Cabinet"],
    ["Reduce non-billable allocation", "Reduce non-billable allocation"],
    ["I have an idea: bulk upload", "bulk upload"],
    ["Create a product", "Create a product"],
    ["", "Untitled"],
  ])("%s → %s", (text, expected) => {
    expect(nameFromRequest(text)).toBe(expected);
  });
  it.each([
    [
      'Track an RFP named "QA-20261114-RFP" in Work. The client is not yet known, the owner is not assigned, and the deadline is unknown. Do not invent these values or start delivery.',
      "QA-20261114-RFP",
    ],
    [
      "Create product named QA-20261114-PRODUCT for testing the intake. Do not start delivery.",
      "QA-20261114-PRODUCT",
    ],
    ["Create a product called Atlas for testing. Nothing else.", "Atlas"],
  ])("takes only the name: %s", (text, expected) => {
    expect(nameFromRequest(text)).toBe(expected);
  });
  it.each([
    [
      "Create a product named QA-20261114-MoCA for testing the MoCA E-Cabinet AI BRD. Use only Azure DevOps TahalufCollection/POCs. Do not publish anything yet.",
      "QA-20261114-MoCA",
    ],
    [
      "Create a project named Atlas Rollout for the Gulf team. Use only Azure DevOps.",
      "Atlas Rollout",
    ],
    [
      'Create a product called "MoCA Cabinet" for testing. Do not publish.',
      "MoCA Cabinet",
    ],
    ['Create a project "Gulf Pilot" for the Gulf team.', "Gulf Pilot"],
    [
      "Create a product QA-20261114-MoCA for testing the BRD. Do not publish.",
      "QA-20261114-MoCA",
    ],
    ["Create a product MoCA Cabinet. Use only Azure DevOps.", "MoCA Cabinet"],
  ])("takes the stated name: %s", (text, expected) => {
    expect(nameFromRequest(text)).toBe(expected);
  });
  it("falls back to a short title when no name is stated", () => {
    const text =
      "Build something to help clinics track appointments with patients across the region quickly. Do not publish anything yet.";
    const name = nameFromRequest(text);
    expect(name.length).toBeLessThanOrEqual(60);
    expect(text.startsWith(name)).toBe(true);
    expect(nameFromRequest("Plan the launch. Use only Azure DevOps.")).toBe(
      "Plan the launch",
    );
  });
  it("keeps names short", () => {
    expect(nameFromRequest("x".repeat(200))).toHaveLength(78);
  });
});

describe("rfpFromRequest", () => {
  const groups = [{ id: "employer", name: "Employer" }];
  it("leaves unknown client, deadline and group empty", () => {
    expect(
      rfpFromRequest(
        'Track an RFP named "QA-20261114-RFP" in Work. The client is not yet known, the owner is not assigned, and the deadline is unknown. Do not invent these values or start delivery.',
        groups,
      ),
    ).toEqual({
      name: "QA-20261114-RFP",
      client: null,
      due: null,
      groupId: null,
    });
  });
  it("reads only what is stated", () => {
    expect(
      rfpFromRequest(
        'Track an RFP named "Metro" in Employer. The client is DMT. Due 5 March.',
        groups,
      ),
    ).toEqual({
      name: "Metro",
      client: "DMT",
      due: "5 March",
      groupId: "employer",
    });
    expect(
      rfpFromRequest("Track an RFP from DMT, due 5 March", groups),
    ).toEqual({
      name: "DMT",
      client: "DMT",
      due: "5 March",
      groupId: null,
    });
  });
});

describe("rfpDetails", () => {
  const now = new Date("2026-11-14T10:00:00Z");
  const none = {
    client: null,
    deadline: null,
    responseOwner: null,
    accountOwner: null,
    presales: null,
  };
  it("reads the labelled facts of the Home request and nothing else", () => {
    expect(
      rfpDetails(
        'Create an RFP named "QA-20261114-RFP-Retest" in Work. Track only: client "QA Sandbox", deadline 2026-12-01, owner Tamer, status Received.',
        now,
      ),
    ).toEqual({
      ...none,
      client: "QA Sandbox",
      deadline: "2026-12-01T00:00:00.000Z",
      accountOwner: "Tamer",
    });
  });
  it("reads the client of a project request", () => {
    expect(
      rfpDetails("Create a project for client Acme Corp, due 2026-12-01", now)
        .client,
    ).toBe("Acme Corp");
    expect(rfpDetails("Create a project called Portal", now).client).toBeNull();
  });
  it("keeps unknown values empty", () => {
    expect(
      rfpDetails(
        "Track an RFP. The client is not yet known, the owner is not assigned, and the deadline is unknown.",
        now,
      ),
    ).toEqual(none);
  });
  it("reads the incident sentence without moving the owner", () => {
    expect(
      rfpDetails(
        "Track a new RFP called QA-20261114-RFP-Smart-Inspection for client QA Test Client, due 25 November 2026. RFP owner is Sara; the response owner is not known yet. This is synthetic QA data.",
        now,
      ),
    ).toEqual({
      ...none,
      client: "QA Test Client",
      deadline: "2026-11-25T00:00:00.000Z",
      accountOwner: "Sara",
    });
  });
  it.each([
    ["for client Acme Ltd due 5 Dec 2026", "Acme Ltd", "2026-12-05"],
    ["client Acme, deadline: November 25, 2026", "Acme", "2026-11-25"],
    ["client: Acme; due 25/11/2026", "Acme", "2026-11-25"],
    ['client is "Acme, Inc" due 25th Nov 2026', "Acme, Inc", "2026-11-25"],
    ["client Acme due 17 November", "Acme", "2026-11-17"],
    ["client Acme due 10 November", "Acme", "2027-11-10"],
    ["client Acme due in 10 days", "Acme", "2026-11-24"],
    ["client Acme due 31 February 2026", "Acme", null],
  ])("reads client and deadline from %s", (text, client, day) => {
    expect(rfpDetails(text, now)).toMatchObject({
      client,
      deadline: day ? day + "T00:00:00.000Z" : null,
    });
  });
  it.each([
    [
      "Response owner is Dana. Sales owner: Omar, pre-sales Lena",
      { responseOwner: "Dana", accountOwner: "Omar", presales: "Lena" },
    ],
    [
      "sales or account owner Omar and pre-sales contact is Lena.",
      { accountOwner: "Omar", presales: "Lena" },
    ],
    ["response owner not known yet, presales TBD", {}],
    ["owner is Sara", { accountOwner: "Sara" }],
  ])("reads owners from %s", (text, expected) => {
    expect(rfpDetails(text, now)).toEqual({ ...none, ...expected });
  });
});

describe("permissionChanges", () => {
  const row = (id: string, createdAt: string, revokedAt: string | null) => ({
    id,
    groupId: "g",
    destination: "notion",
    action: "create",
    createdAt,
    revokedAt,
  });
  it("lists every grant and revoke, newest first", () => {
    const changes = permissionChanges([
      row("a", "2026-11-01T10:00:00Z", "2026-11-03T10:00:00Z"),
      row("b", "2026-11-02T10:00:00Z", null),
    ]);
    expect(changes.map((c) => `${c.id}:${c.kind}`)).toEqual([
      "a:revoked",
      "b:allowed",
      "a:allowed",
    ]);
  });
  it("puts a revoke after its grant when both share a moment, and keeps 20", () => {
    const same = "2026-11-01T10:00:00Z";
    expect(
      permissionChanges([row("a", same, same)]).map((c) => c.kind),
    ).toEqual(["revoked", "allowed"]);
    const many = Array.from({ length: 30 }, (_, i) =>
      row(`p${i}`, `2026-11-${String(i + 1).padStart(2, "0")}T00:00:00Z`, null),
    );
    const kept = permissionChanges(many);
    expect(kept).toHaveLength(20);
    expect(kept[0]!.id).toBe("p29");
  });
});

describe("messages that are for Firstmate, not work to file", () => {
  it("only a message that asks for new work of a named kind is asked about", async () => {
    const { asksForNewWork } = await import("../src/work/model.ts");
    for (const text of [
      "Create a product called Atlas",
      "please start a new project for Acme",
      "Track an RFP for the ministry",
      "Add a task: renew the domain",
    ])
      expect(asksForNewWork(text), text).toBe(true);
    for (const text of [
      "What are all the 2ndmates we have available?",
      "Are you able to connect to Azure devops for me?",
      "Help me respond to this email",
      "Connect to Jira",
      "Build me a wireframe for onboarding",
      "The product team asked to create a task list later",
    ])
      expect(asksForNewWork(text), text).toBe(false);
  });
});

describe("built-in commands", () => {
  it("reads a command typed in full, longest name first", async () => {
    const { builtInCommand, commandAsRequest, pickByName } =
      await import("../src/work/shell.ts");
    expect(builtInCommand("/model")).toEqual({ name: "model", argument: "" });
    expect(builtInCommand("/model  Opus 5.5 ")).toEqual({
      name: "model",
      argument: "Opus 5.5",
    });
    expect(builtInCommand("/sprint plan next two weeks")).toEqual({
      name: "sprint plan",
      argument: "next two weeks",
    });
    for (const text of [
      "model",
      "/modelx",
      "/unknown",
      "say /model",
      "/prd\nmore",
    ])
      expect(builtInCommand(text), text).toBeNull();

    // Work commands reach Firstmate in plain words; app commands never do.
    expect(commandAsRequest("/research pricing in the GCC")).toBe(
      "Research a question: pricing in the GCC",
    );
    expect(commandAsRequest("/prd")).toBe("Draft a short PRD.");
    expect(commandAsRequest("/model opus")).toBeNull();
    expect(commandAsRequest("/theme")).toBeNull();
    expect(commandAsRequest("Draft a PRD")).toBeNull();

    const models = [
      { id: "github-copilot/claude-opus-5.5", label: "Claude Opus 5.5" },
      { id: "github-copilot/claude-opus-5", label: "Claude Opus 5" },
      { id: "openai-codex/gpt-5", label: "GPT-5" },
    ];
    expect(pickByName(models, "gpt")).toEqual({ one: models[2] });
    // An exact name wins over the longer names that contain it.
    expect(pickByName(models, "claude opus 5")).toEqual({ one: models[1] });
    expect(pickByName(models, "opus")).toEqual({
      several: [models[0], models[1]],
    });
    expect(pickByName(models, "gemini")).toEqual({ none: true });
  });
});

describe("sending a command from the menu", () => {
  it("sends a command typed in full or with words after it, and completes a partial one", async () => {
    const { commandReadyToSend } = await import("../src/work/shell.ts");
    expect(commandReadyToSend("/model", "/model ")).toBe(true);
    expect(commandReadyToSend("/model opus 5.5", "/model ")).toBe(true);
    expect(commandReadyToSend("/theme light", "/theme ")).toBe(true);
    // Still being typed: Enter completes it.
    expect(commandReadyToSend("/mo", "/model ")).toBe(false);
    // A mention is completed, never sent half-typed.
    expect(commandReadyToSend("ask @Atl", "@Atlas ")).toBe(false);
  });
});

describe("a message that asks for new work by name (owner's trace, 19 November 2026)", () => {
  it("names the kind and the name, so the work is made and Firstmate starts", () => {
    expect(
      newWorkNamed(
        "Create a new product named AI perosnal assistant and interview me to learn more about it",
      ),
    ).toEqual({ type: "product", name: "AI perosnal assistant" });
    expect(
      newWorkNamed(
        "Create a new PRD for a new product name product-3. Help me figure out the problem",
      ),
    ).toEqual({ type: "product", name: "product-3" });
    expect(
      newWorkNamed(
        'Create a new product named "Research and Development" and interview me',
      ),
    ).toEqual({ type: "product", name: "Research and Development" });
    expect(newWorkNamed("Create a new project called “Go to Market”")).toEqual({
      type: "project",
      name: "Go to Market",
    });
    expect(newWorkNamed('Start a new project called "Dubai pilot"')).toEqual({
      type: "project",
      name: "Dubai pilot",
    });
  });

  it("asks nothing new of plain requests or unnamed work", () => {
    expect(newWorkNamed("Read from notion about me and who I am")).toBeNull();
    expect(newWorkNamed("Create a new product for the pilot")).toBeNull();
    expect(
      asksForNewWork("Create a new PRD for a new product name product-3"),
    ).toBe(true);
  });

  it('does not file an "interview me" request as interview notes', () => {
    expect(
      classifyMaterial({
        text: "Create a product and interview me one question at a time",
      }),
    ).toEqual({ kind: "work", type: "product" });
    expect(
      classifyMaterial({ text: "Interview with Sara about onboarding" }),
    ).toEqual({
      kind: "record",
      type: "interview",
    });
  });
});

describe("grouping chats by Amun's own rules (owner, 20 November 2026)", () => {
  const today = "2026-11-20";
  const gitex = { id: "a-gitex", name: "Gitex" };

  it("reads the name after 'for', the priority and the day", () => {
    const text =
      "Create a new project for Gitex to be high priority and ready on Dec 6";
    expect(newWorkNamed(text)).toEqual({ type: "project", name: "Gitex" });
    expect(routeNewWork({ text, today, areas: [], inside: null })).toEqual({
      route: "create",
      request: {
        type: "project",
        name: "Gitex",
        priority: "high",
        dueDate: "2026-12-06",
      },
    });
  });

  it("names nothing when 'for' is followed by ordinary words", () => {
    expect(newWorkNamed("Create a new product for the pilot")).toBeNull();
    expect(newWorkNamed("Create a new task for me to review")).toBeNull();
    expect(
      routeNewWork({
        text: "Create a landing page for Gitex",
        today,
        areas: [gitex],
        inside: null,
      }),
    ).toEqual({ route: "none" });
  });

  it("only stores a priority the owner said", () => {
    expect(statedPriority("make it high priority")).toBe("high");
    expect(statedPriority("priority: low")).toBe("low");
    expect(statedPriority("top-priority work")).toBe("urgent");
    expect(statedPriority("this is urgent")).toBe("urgent");
    expect(statedPriority("ready on Dec 6")).toBeNull();
  });

  it("takes the next day that has not passed, and never invents one", () => {
    expect(statedDueDate("ready on Dec 6", today)).toBe("2026-12-06");
    expect(statedDueDate("due 6th of December", today)).toBe("2026-12-06");
    expect(statedDueDate("by Nov 20", today)).toBe("2026-11-20");
    expect(statedDueDate("by Nov 3", today)).toBe("2027-11-03");
    expect(statedDueDate("by March 3, 2028", today)).toBe("2028-03-03");
    expect(statedDueDate("due 2026-12-06", today)).toBe("2026-12-06");
    expect(statedDueDate("on Feb 30", today)).toBeNull();
    expect(statedDueDate("as soon as possible", today)).toBeNull();
    expect(statedDueDate("in May we may start", today)).toBeNull();
    // A start or kickoff day is not a deadline (review of pull request 44).
    expect(statedDueDate("It starts on Dec 6 and is due Dec 20", today)).toBe(
      "2026-12-20",
    );
    expect(statedDueDate("Kickoff is on Dec 6", today)).toBeNull();
    expect(statedDueDate("It starts 2026-12-06", today)).toBeNull();
    expect(statedDueDate("deadline: 20 December", today)).toBe("2026-12-20");
    expect(statedDueDate("no later than Dec 20", today)).toBe("2026-12-20");
  });

  it("treats spelling variants as the same folder", () => {
    expect(sameWorkName("Amun SDK", "AMUN-SDK")).toBe(true);
    expect(sameWorkName("AmunSDK", "amun.sdk")).toBe(true);
    expect(sameWorkName("Gitex", "Gitex 2026")).toBe(false);
    expect(sameWorkName("--", "")).toBe(false);
  });

  it("asks before making a twin of an existing folder", () => {
    expect(
      routeNewWork({
        text: "Create a new project called gitex",
        today,
        areas: [gitex],
        inside: null,
      }),
    ).toMatchObject({ route: "existing", areaId: "a-gitex" });
  });

  it("holds a request for other work typed inside a folder", () => {
    const text =
      "Create a new product called Amun-SDK and help me build the vision and problem statement for it";
    expect(
      routeNewWork({
        text,
        today,
        areas: [gitex],
        inside: { id: "a-gitex", keptHere: [] },
      }),
    ).toEqual({
      route: "offer_move",
      request: {
        type: "product",
        name: "Amun-SDK",
        priority: null,
        dueDate: null,
      },
      areaId: null,
    });
    expect(
      routeNewWork({
        text,
        today,
        areas: [gitex, { id: "a-sdk", name: "AMUN SDK" }],
        inside: { id: "a-gitex", keptHere: [] },
      }),
    ).toMatchObject({ route: "offer_move", areaId: "a-sdk" });
  });

  it("does not ask again once the owner kept that name here", () => {
    expect(
      routeNewWork({
        text: "Create a new product called Amun-SDK",
        today,
        areas: [gitex],
        inside: { id: "a-gitex", keptHere: ["amun sdk"] },
      }),
    ).toEqual({ route: "none" });
    expect(
      routeNewWork({
        text: "Create a new task for Gitex",
        today,
        areas: [gitex],
        inside: { id: "a-gitex", keptHere: [] },
      }),
    ).toEqual({ route: "none" });
  });
});

it("recognizes an explicit creation request after the owner's problem statement", () => {
  expect(
    newWorkNamed(
      "Our product managers need one place to work. I still want to create a new product named Amun for me",
    ),
  ).toEqual({ type: "product", name: "Amun" });
});

describe("work intake and initiative naming (22 November 2026 handoff)", () => {
  const today = "2026-11-22";

  it("handles the three explicit intake forms: Product, Project ('for client X'), and Initiative (+ legacy task)", () => {
    const prod =
      "Create a new product called Amun-SDK and help me build the vision and problem statement for it";
    expect(
      routeNewWork({ text: prod, today, areas: [], inside: null }),
    ).toEqual({
      route: "create",
      request: {
        type: "product",
        name: "Amun-SDK",
        priority: null,
        dueDate: null,
      },
    });

    const proj =
      "Create a new project called Gitex for client X to be high priority and ready on Dec 6";
    expect(newWorkNamed(proj)).toEqual({ type: "project", name: "Gitex" });
    expect(
      routeNewWork({ text: proj, today, areas: [], inside: null }),
    ).toEqual({
      route: "create",
      request: {
        type: "project",
        name: "Gitex",
        client: "X",
        priority: "high",
        dueDate: "2026-12-06",
      },
    });

    const init1 =
      "Start an Initiative called Q4 Demo Prep due Nov 30 high priority";
    expect(newWorkNamed(init1)).toEqual({ type: "task", name: "Q4 Demo Prep" });
    expect(
      routeNewWork({ text: init1, today, areas: [], inside: null }),
    ).toEqual({
      route: "create",
      request: {
        type: "task",
        name: "Q4 Demo Prep",
        priority: "high",
        dueDate: "2026-11-30",
      },
    });

    const init2 = "Start an Initiative: Renew domain certificate";
    expect(newWorkNamed(init2)).toEqual({
      type: "task",
      name: "Renew domain certificate",
    });

    const legacyTask = "Add a task: Renew domain certificate";
    expect(newWorkNamed(legacyTask)).toEqual({
      type: "task",
      name: "Renew domain certificate",
    });
    expect(nameFromRequest("Start an Initiative: Prepare launch deck")).toBe(
      "Prepare launch deck",
    );
  });

  it("does not mistake 'for client X' as the project's own name when no project name was given", () => {
    expect(
      newWorkNamed("Create a new project for client X due Dec 6"),
    ).toBeNull();
  });
});
