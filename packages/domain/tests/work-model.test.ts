import { describe, expect, it } from "vitest";
import {
  classifyMaterial,
  inferWorkArea,
  intake,
  linkRecord,
  nameFromRequest,
  needsLinking,
  type SupportingRecord,
  type WorkArea,
} from "../src/work/model.ts";
import {
  appliedRule,
  approvalSurface,
  approveLabel,
  authority,
  changeSinceApproval,
  gateFor,
  planFingerprint,
  ruleCandidate,
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
  it("keeps names short", () => {
    expect(nameFromRequest("x".repeat(200))).toHaveLength(78);
  });
});
