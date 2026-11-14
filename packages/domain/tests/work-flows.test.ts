import { describe, expect, it } from "vitest";
import {
  conversionSuggestion,
  decideFinding,
  externalChange,
  isCommitted,
  memoryUpdate,
  objectiveProgress,
  rfpCard,
  rfpHandoff,
  route,
  scopeCheck,
  syncLabel,
  trackerName,
  type Claim,
  type Rfp,
  type RoutingRule,
} from "../src/work/flows.ts";
import {
  attentionList,
  attentionRow,
  awaySummary,
  connectionStatus,
  failureSurface,
  fromLegacyStatus,
  islandItem,
  nextRetry,
  previewNote,
  rankWork,
  shouldAutoTest,
  updateMessage,
  type Attention,
  type WorkSignal,
} from "../src/work/home.ts";

const rules: RoutingRule[] = [
  { id: "r1", groupId: "employer", condition: "delivery", tracker: "ado" },
  { id: "r2", groupId: "employer", condition: null, tracker: "notion" },
  { id: "r3", groupId: "personal", condition: null, tracker: "amun" },
];

describe("route (F8)", () => {
  const base = { rules, connected: ["ado", "notion"] };
  it("asks the group, then the route, when unknown", () => {
    expect(route({ ...base, groupId: null, workType: "task" })).toEqual({
      step: "ask_group",
    });
    expect(route({ ...base, groupId: "side", workType: "task" })).toEqual({
      step: "ask_route",
      groupId: "side",
      suggestions: ["ado", "notion"],
    });
  });
  it("prefers the conditional rule and always asks before an ADO write", () => {
    expect(
      route({
        ...base,
        groupId: "employer",
        workType: "project",
        instructed: true,
      }),
    ).toEqual({ step: "ask_approval", tracker: "ado", gate: "ado_write" });
  });
  it("falls back to the group's general rule", () => {
    expect(route({ ...base, groupId: "employer", workType: "task" })).toEqual({
      step: "ask_approval",
      tracker: "notion",
      gate: null,
    });
    expect(
      route({
        ...base,
        groupId: "employer",
        workType: "task",
        instructed: true,
      }),
    ).toEqual({ step: "write", tracker: "notion", ruleId: "r2" });
  });
  it("writes with a matching standing permission", () => {
    expect(
      route({
        ...base,
        groupId: "employer",
        workType: "task",
        permissions: [
          {
            id: "p",
            groupId: "employer",
            destination: "notion",
            action: "create",
            revokedAt: null,
          },
        ],
      }),
    ).toMatchObject({ step: "write" });
  });
  it("keeps the destination when it is unreachable", () => {
    expect(
      route({ rules, connected: [], groupId: "employer", workType: "task" }),
    ).toEqual({
      step: "blocked",
      tracker: "notion",
      reason:
        "Notion is not connected. The work stays routed there until it is.",
    });
  });
  it("treats Amun's own list as always reachable", () => {
    expect(
      route({
        rules,
        connected: [],
        groupId: "personal",
        workType: "task",
        instructed: true,
      }),
    ).toMatchObject({ step: "write", tracker: "amun" });
  });
  it("names trackers for people", () => {
    expect(trackerName("ado")).toBe("Azure DevOps");
    expect(trackerName("linear")).toBe("linear");
  });
});

describe("decideFinding (F3)", () => {
  it("keeps approvals local to each work area", () => {
    let decisions = decideFinding([], {
      findingId: "f",
      workAreaId: "alpha",
      action: "approve",
    });
    decisions = decideFinding(decisions, {
      findingId: "f",
      workAreaId: "beta",
      action: "reject",
    });
    expect(decisions).toEqual([
      { findingId: "f", workAreaId: "alpha", state: "approved" },
      { findingId: "f", workAreaId: "beta", state: "rejected" },
    ]);
  });
  it("keeps the approval when the write fails and commits only when written", () => {
    let decisions = decideFinding([], {
      findingId: "f",
      workAreaId: "a",
      action: "approve",
    });
    decisions = decideFinding(decisions, {
      findingId: "f",
      workAreaId: "a",
      action: "write_failed",
    });
    expect(decisions[0]!.state).toBe("write_failed");
    expect(isCommitted(decisions[0]!.state)).toBe(false);
    decisions = decideFinding(decisions, {
      findingId: "f",
      workAreaId: "a",
      action: "written",
    });
    expect(isCommitted(decisions[0]!.state)).toBe(true);
  });
  it("never writes an unapproved or deferred finding", () => {
    const deferred = decideFinding([], {
      findingId: "f",
      workAreaId: "a",
      action: "defer",
    });
    expect(deferred[0]!.state).toBe("deferred");
    expect(
      decideFinding(deferred, {
        findingId: "f",
        workAreaId: "a",
        action: "written",
      }),
    ).toBe(deferred);
    expect(
      decideFinding([], { findingId: "f", workAreaId: "a", action: "written" }),
    ).toEqual([]);
  });
});

describe("conversionSuggestion (F4, Q78)", () => {
  it("suggests once the task has milestones and people", () => {
    expect(
      conversionSuggestion({ milestones: 1, people: 1, steps: 3 }),
    ).toBeNull();
    expect(
      conversionSuggestion({ milestones: 3, people: 4, steps: 5 }),
    ).toMatchObject({
      text: "3 milestones and 4 people. Make it a project?",
      choices: ["Convert", "Keep as task"],
      keeps: ["history", "links", "objective", "tracker"],
    });
    expect(
      conversionSuggestion({ milestones: 0, people: 1, steps: 8 })?.text,
    ).toBe("0 milestones and 1 person. Make it a project?");
    expect(
      conversionSuggestion({ milestones: 1, people: 9, steps: 8 })?.text,
    ).toContain("1 milestone and");
  });
  it("does not ask again unless it grows much further", () => {
    const declinedAt = { milestones: 3, people: 4, steps: 5 };
    expect(
      conversionSuggestion({ milestones: 4, people: 5, steps: 6, declinedAt }),
    ).toBeNull();
    expect(
      conversionSuggestion({ milestones: 6, people: 5, steps: 6, declinedAt }),
    ).not.toBeNull();
  });
});

describe("scopeCheck (F6, Q77)", () => {
  it("plans normally inside scope or with an approved change request", () => {
    expect(scopeCheck({ inScope: true, approvedChangeRequest: false })).toEqual(
      { step: "plan" },
    );
    expect(scopeCheck({ inScope: false, approvedChangeRequest: true })).toEqual(
      { step: "plan" },
    );
  });
  it("shows the amber card once", () => {
    expect(
      scopeCheck({
        inScope: false,
        approvedChangeRequest: false,
        brdVersion: "BRD v2",
      }),
    ).toEqual({
      step: "ask",
      text: "Outside BRD v2 · no approved change request · deadline unchanged",
      choices: [
        "Add anyway (record exception)",
        "Link a change request",
        "Keep out",
      ],
    });
    expect(
      scopeCheck({ inScope: false, approvedChangeRequest: false }),
    ).toMatchObject({
      text: expect.stringContaining("the approved BRD"),
    });
  });
  it("remembers the answer for that item and tags the exception honestly", () => {
    expect(
      scopeCheck({
        inScope: false,
        approvedChangeRequest: false,
        prior: "add_anyway",
      }),
    ).toEqual({ step: "plan", tag: "Exception · no CR", exception: true });
    expect(
      scopeCheck({
        inScope: false,
        approvedChangeRequest: false,
        prior: "keep_out",
      }),
    ).toEqual({ step: "keep_out" });
  });
});

describe("RFP tracking and handoff (F7)", () => {
  const now = Date.parse("2026-11-12T08:00:00Z");
  const rfp = (extra: Partial<Rfp> = {}): Rfp => ({
    id: "r",
    client: "Ministry",
    stage: "in_response",
    deadline: "2026-11-17T08:00:00Z",
    responseOwner: null,
    accountOwner: null,
    presales: null,
    proposalSigned: false,
    brdApproved: false,
    deliveryProjectId: null,
    lossReason: null,
    ...extra,
  });
  it("counts down and flags a missing owner", () => {
    expect(rfpCard(rfp(), now)).toMatchObject({
      countdown: "Due in 5 days",
      missingOwner: true,
      atRisk: true,
    });
    expect(
      rfpCard(rfp({ deadline: "2026-11-13T08:00:00Z" }), now).countdown,
    ).toBe("Due in 1 day");
    expect(
      rfpCard(rfp({ deadline: "2026-11-12T08:00:00Z" }), now).countdown,
    ).toBe("Due today");
    expect(
      rfpCard(rfp({ deadline: "2026-11-10T08:00:00Z" }), now).countdown,
    ).toBe("2 days overdue");
    expect(
      rfpCard(rfp({ deadline: "2026-11-11T08:00:00Z" }), now).countdown,
    ).toBe("1 day overdue");
    expect(rfpCard(rfp({ deadline: null }), now)).toMatchObject({
      countdown: "No deadline set",
      atRisk: false,
    });
  });
  it("stops nagging once submitted and explains won and lost states", () => {
    expect(rfpCard(rfp({ stage: "submitted" }), now)).toMatchObject({
      countdown: null,
      missingOwner: false,
    });
    expect(rfpCard(rfp({ stage: "won" }), now).subline).toBe(
      "Awaiting signature",
    );
    expect(
      rfpCard(rfp({ stage: "won", proposalSigned: true }), now).subline,
    ).toBe("Awaiting approved BRD");
    expect(
      rfpCard(
        rfp({ stage: "won", proposalSigned: true, brdApproved: true }),
        now,
      ).subline,
    ).toBe("Ready to hand to delivery");
    expect(rfpCard(rfp({ stage: "lost" }), now).subline).toBe(
      "Loss reason unknown",
    );
    expect(
      rfpCard(rfp({ stage: "lost", lossReason: "Price" }), now).subline,
    ).toBe("Price");
  });
  it("hands off only after a signed proposal and an approved BRD", () => {
    expect(rfpHandoff(rfp())).toEqual({ step: "not_won" });
    expect(rfpHandoff(rfp({ stage: "lost" }))).toEqual({ step: "not_won" });
    expect(rfpHandoff(rfp({ stage: "won" }))).toEqual({
      step: "wait",
      pending: "signature",
    });
    expect(rfpHandoff(rfp({ stage: "won", proposalSigned: true }))).toEqual({
      step: "wait",
      pending: "brd",
    });
    expect(
      rfpHandoff(
        rfp({ stage: "won", proposalSigned: true, brdApproved: true }),
      ),
    ).toEqual({
      step: "create",
    });
  });
  it("reuses an existing delivery project instead of duplicating it", () => {
    expect(
      rfpHandoff(
        rfp({
          stage: "handed_to_delivery",
          proposalSigned: true,
          brdApproved: true,
          deliveryProjectId: "p1",
        }),
      ),
    ).toEqual({ step: "reuse", projectId: "p1" });
  });
});

describe("externalChange (F9, Q75)", () => {
  const change = { itemId: "124", field: "Sprint", before: "15", after: "16" };
  it("always adds an Activity line and a flag, never a revert", () => {
    expect(externalChange({ ...change, affectsCommitment: false })).toEqual({
      activity: "Sprint changed in Azure DevOps: 15 → 16",
      flag: "Changed in ADO",
      attention: null,
      revert: false,
    });
  });
  it("raises attention only when a commitment is at risk", () => {
    expect(
      externalChange({
        ...change,
        before: null,
        after: null,
        affectsCommitment: true,
      }),
    ).toMatchObject({
      activity: "Sprint changed in Azure DevOps: empty → empty",
      attention: { primary: "Review impact", overflow: ["Acknowledge"] },
    });
  });
});

describe("memoryUpdate (F10)", () => {
  const claim = (value: string, confirmed: boolean): Claim => ({
    key: "manager",
    value,
    source: "Email from Sara",
    date: "10 Nov",
    confirmed,
  });
  it("records new or matching facts without asking", () => {
    expect(memoryUpdate(null, claim("A", false))).toEqual({
      step: "record",
      supersedes: null,
    });
    expect(memoryUpdate(claim("A", true), claim("A", false))).toEqual({
      step: "record",
      supersedes: null,
    });
  });
  it("asks, citing source and date, when evidence contradicts confirmed context", () => {
    expect(memoryUpdate(claim("A", true), claim("B", false))).toMatchObject({
      step: "ask",
      text: 'Email from Sara (10 Nov) says "B". You told me "A". Which is right?',
    });
  });
  it("supersedes while keeping history when the user says so", () => {
    const current = claim("A", true);
    expect(memoryUpdate(current, claim("B", true))).toEqual({
      step: "record",
      supersedes: current,
    });
    expect(memoryUpdate(claim("A", false), claim("B", false)).step).toBe(
      "record",
    );
  });
  it("never claims an unconfirmed save", () => {
    expect(syncLabel("saved")).toBeNull();
    expect(syncLabel("pending")).toContain("waiting to sync");
    expect(syncLabel("unsaved")).toBe("Not saved to Notion yet");
  });
});

describe("objectiveProgress (UC06)", () => {
  const base = {
    metric: "% billable",
    baseline: 60,
    target: 90,
    current: 75,
    evidenceDate: null,
    reviewDate: null,
    conflict: false,
  };
  it("tracks progress between baseline and target", () => {
    expect(objectiveProgress(base)).toEqual({
      state: "tracking",
      ratio: 0.5,
      label: "75 of 90 % billable",
    });
  });
  it("marks the target reached and moves to review", () => {
    expect(
      objectiveProgress({ ...base, current: 92, reviewDate: "1 Feb" }),
    ).toMatchObject({
      state: "reached",
      label: "Target reached · next review 1 Feb",
    });
    expect(objectiveProgress({ ...base, current: 90 }).label).toBe(
      "Target reached",
    );
    expect(
      objectiveProgress({ ...base, baseline: 90, current: 10 }).state,
    ).toBe("reached");
  });
  it("labels unknowns instead of inventing a number", () => {
    expect(objectiveProgress({ ...base, target: null }).label).toBe(
      "Target not set",
    );
    expect(objectiveProgress({ ...base, baseline: null }).label).toBe(
      "Baseline unknown",
    );
    expect(objectiveProgress({ ...base, current: null }).label).toBe(
      "No measurement yet",
    );
  });
  it("keeps a source conflict visible rather than claiming a result", () => {
    expect(objectiveProgress({ ...base, conflict: true })).toEqual({
      state: "conflict",
      label: "Sources disagree · review",
    });
  });
});

const item = (extra: Partial<Attention>): Attention => ({
  id: "i",
  kind: "approval",
  groupName: "Employer",
  workAreaId: "w",
  workAreaName: "TICAO",
  title: "6 stories ready for Azure DevOps",
  detail: "Sprint 14",
  state: "open",
  createdAt: "2026-11-12T08:00:00Z",
  ...extra,
});

describe("Home attention (Q50–Q51)", () => {
  it("gives a row at most one primary button and predictable names", () => {
    const row = attentionRow(
      item({ batch: { count: 6, noun: "story", summary: "s", items: [] } }),
    );
    expect(row).toMatchObject({
      label: "Approval · Employer / TICAO",
      primary: "Review changes",
      overflow: ["Open project", "Snooze attention item"],
      rowAction: "open_conversation",
      tray: true,
    });
  });
  it("names the other kinds and leaves questions without a button", () => {
    expect(attentionRow(item({ kind: "offer" })).primary).toBe("Yes, draft it");
    expect(attentionRow(item({ kind: "result" })).primary).toBe(
      "View findings",
    );
    expect(attentionRow(item({ kind: "risk" })).primary).toBe("Review impact");
    expect(attentionRow(item({ kind: "risk" })).overflow).toEqual([
      "Open project",
      "Acknowledge",
      "Snooze attention item",
    ]);
    expect(attentionRow(item({ kind: "failure" })).primary).toBe(
      "See what happened",
    );
    const question = attentionRow(
      item({
        kind: "question",
        workAreaId: null,
        workAreaName: null,
        groupName: null,
      }),
    );
    expect(question).toMatchObject({
      primary: null,
      label: "Question",
      overflow: ["Snooze attention item"],
      tray: false,
    });
    expect(attentionRow(item({ kind: "linking" })).primary).toBeNull();
  });
  it("orders by urgency and filters Done and by kind", () => {
    const items = [
      item({ id: "r", kind: "result" }),
      item({ id: "f", kind: "failure" }),
      item({ id: "a2", kind: "approval", createdAt: "2026-11-12T09:00:00Z" }),
      item({ id: "a1", kind: "approval" }),
      item({ id: "d", kind: "question", state: "done" }),
    ];
    expect(attentionList(items).map((entry) => entry.id)).toEqual([
      "f",
      "a1",
      "a2",
      "r",
    ]);
    expect(attentionList(items, "done").map((entry) => entry.id)).toEqual([
      "d",
    ]);
    expect(attentionList(items, "result").map((entry) => entry.id)).toEqual([
      "r",
    ]);
    expect(islandItem(items)).toMatchObject({ top: { id: "f" }, count: 4 });
    expect(islandItem([])).toEqual({ top: null, count: 0, held: 0 });
    // The chat for a work already asks about its own plan, question or
    // failure, so the sidebar card leaves those out and counts them. A result
    // or an offer has no control in the chat, so it stays on the card.
    const area = items[0]!.workAreaId;
    expect(islandItem(items, area)).toMatchObject({
      top: { id: "r" },
      count: 1,
      held: 3,
    });
    const offer = item({ id: "o", kind: "offer" });
    expect(islandItem([offer], offer.workAreaId)).toMatchObject({
      top: { id: "o" },
      count: 1,
      held: 0,
    });
    const asked = items.filter((entry) => entry.kind !== "result");
    expect(islandItem(asked, area)).toMatchObject({
      top: null,
      count: 0,
      held: 3,
    });
    // Another work's chat being open hides nothing.
    expect(islandItem(items, "somewhere-else")).toMatchObject({
      count: 4,
      held: 0,
    });
  });
  it("summarises what arrived while away", () => {
    const items = [
      item({ id: "1", kind: "result", createdAt: "2026-11-12T09:00:00Z" }),
      item({ id: "2", kind: "result", createdAt: "2026-11-12T09:00:00Z" }),
      item({ id: "3", kind: "question", createdAt: "2026-11-12T09:00:00Z" }),
      item({ id: "4", kind: "failure", createdAt: "2026-11-12T09:00:00Z" }),
      item({ id: "5", kind: "result", createdAt: "2026-11-10T09:00:00Z" }),
    ];
    expect(awaySummary(items, "2026-11-11T00:00:00Z")).toEqual({
      text: "While you were away: 2 results, 1 question, 1 failure",
      kinds: ["result", "question", "failure"],
    });
    expect(awaySummary(items, "2026-11-13T00:00:00Z")).toBeNull();
    expect(awaySummary(items, null)).toBeNull();
  });
});

describe("rankWork (UC18)", () => {
  const now = Date.parse("2026-11-12T08:00:00Z");
  const signal = (extra: Partial<WorkSignal>): WorkSignal => ({
    id: "x",
    stakeholder: 0,
    client: 0,
    dueAt: null,
    effort: null,
    lastContextAt: "2026-11-11T08:00:00Z",
    interest: 0,
    attention: 0,
    done: false,
    ...extra,
  });
  it("lets a boss request outrank a nearer routine deadline", () => {
    const ranked = rankWork(
      [
        signal({ id: "routine", dueAt: "2026-11-20T08:00:00Z", effort: "XS" }),
        signal({
          id: "boss",
          stakeholder: 3,
          dueAt: "2026-12-20T08:00:00Z",
          effort: "S",
        }),
      ],
      now,
    );
    expect(ranked[0]!.id).toBe("boss");
  });
  it("raises a large job due in three weeks above a small one due sooner", () => {
    const ranked = rankWork(
      [
        signal({ id: "small", dueAt: "2026-11-22T08:00:00Z", effort: "XS" }),
        signal({ id: "large", dueAt: "2026-12-03T08:00:00Z", effort: "L" }),
      ],
      now,
    );
    expect(ranked[0]!.id).toBe("large");
  });
  it("treats staleness as missing context, not lack of progress", () => {
    const ranked = rankWork(
      [
        signal({ id: "stale", lastContextAt: "2026-10-28T08:00:00Z" }),
        signal({ id: "fresh" }),
      ],
      now,
    );
    expect(ranked[0]).toMatchObject({
      id: "stale",
      note: "No update for 15 days · context may be out of date",
    });
    expect(ranked[1]!.note).toBeNull();
    expect(rankWork([signal({ lastContextAt: null })], now)[0]!.note).toContain(
      "10 days",
    );
  });
  it("counts overdue work, learned interest and open attention, and hides done work", () => {
    const ranked = rankWork(
      [
        signal({ id: "done", stakeholder: 3, done: true }),
        signal({ id: "overdue", dueAt: "2026-11-01T08:00:00Z" }),
        signal({ id: "asked", interest: 9 }),
        signal({ id: "waiting", attention: 1 }),
        signal({ id: "client", client: 3 }),
      ],
      now,
    );
    expect(ranked.map((entry) => entry.id)).toEqual([
      "overdue",
      "client",
      "asked",
      "waiting",
    ]);
  });
});

describe("connection status (Q11–Q12)", () => {
  it("has four states with one action at most", () => {
    expect(connectionStatus({ state: "checking" })).toMatchObject({
      text: "Checking…",
      action: null,
    });
    expect(connectionStatus({ state: "connected" })).toMatchObject({
      text: "Connected",
      action: null,
    });
    expect(connectionStatus({ state: "signed_out" })).toMatchObject({
      text: "Signed out",
      action: "Sign in",
    });
    expect(
      connectionStatus({ state: "not_working", reason: "out_of_credits" }),
    ).toMatchObject({
      text: "Not working · Out of credits",
      action: "Add credits",
      tone: "error",
    });
    expect(
      connectionStatus({ state: "not_working", reason: "model_not_enabled" })
        .action,
    ).toBe("Choose another model");
    expect(connectionStatus({ state: "not_working" }).text).toBe(
      "Not working · Service down",
    );
  });
  it("auto-tests on sign-in and at most daily on open", () => {
    const now = Date.parse("2026-11-12T08:00:00Z");
    expect(shouldAutoTest(null, now, "open")).toBe(true);
    expect(shouldAutoTest("2026-11-12T01:00:00Z", now, "open")).toBe(false);
    expect(shouldAutoTest("2026-11-11T07:00:00Z", now, "open")).toBe(true);
    expect(shouldAutoTest("2026-11-12T07:59:00Z", now, "sign_in")).toBe(true);
  });
  it("maps the sign-in service's states without crying wolf", () => {
    // Stored and accepted is "Signed in"; only a real reply is "Connected".
    expect(fromLegacyStatus("configured")).toBe("checking");
    expect(fromLegacyStatus("configured", { checked: true })).toBe("signed_in");
    expect(connectionStatus({ state: "signed_in" })).toMatchObject({
      text: "Signed in",
      action: null,
    });
    expect(fromLegacyStatus(undefined)).toBe("signed_out");
    expect(fromLegacyStatus("missing")).toBe("signed_out");
    expect(fromLegacyStatus("cancelled")).toBe("signed_out");
    expect(fromLegacyStatus("checking")).toBe("checking");
    expect(fromLegacyStatus("configured")).toBe("checking");
    expect(fromLegacyStatus("ready")).toBe("connected");
    expect(fromLegacyStatus("Connected")).toBe("connected");
    // Never signed in: a failed test is just "Signed out".
    expect(fromLegacyStatus("error")).toBe("signed_out");
    expect(fromLegacyStatus("error", { everReady: true })).toBe("not_working");
    expect(fromLegacyStatus("error", { attempted: true })).toBe("not_working");
  });
});

describe("stakeholder update and failures", () => {
  it("keeps the message to 50–90 words and never sends", () => {
    const words = (count: number) =>
      Array.from({ length: count }, () => "word").join(" ");
    expect(updateMessage(words(70))).toMatchObject({ ok: true, hint: null });
    expect(updateMessage(words(20))).toMatchObject({
      ok: false,
      hint: "A little short for an update",
    });
    expect(updateMessage(words(120)).hint).toBe("Longer than a 20-second read");
    expect(updateMessage("").note).toContain("never sends");
  });
  it("says what a proposal has not changed, for its destination", () => {
    expect(previewNote("ado")).toBe("Preview only · No Azure DevOps changes");
    expect(previewNote("amun")).toBe(
      "Preview only · Nothing changes until you approve",
    );
  });
  it("shows active-work failures as a banner and background ones on the Island", () => {
    expect(failureSurface({ activeWorkAreaId: "w", workAreaId: "w" })).toBe(
      "banner",
    );
    expect(failureSurface({ activeWorkAreaId: "w", workAreaId: "x" })).toBe(
      "island",
    );
    expect(failureSurface({ activeWorkAreaId: null, workAreaId: null })).toBe(
      "island",
    );
  });
  it("retries within budget and reconciles uncertain writes first", () => {
    expect(nextRetry({ attempts: 1, uncertainWrite: false })).toBe("retry");
    expect(nextRetry({ attempts: 3, uncertainWrite: false })).toBe("surface");
    expect(nextRetry({ attempts: 0, uncertainWrite: true })).toBe("reconcile");
    expect(nextRetry({ attempts: 1, uncertainWrite: false, budget: 1 })).toBe(
      "surface",
    );
  });
});
