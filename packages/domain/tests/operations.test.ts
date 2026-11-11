import { it, expect } from "vitest";
import {
  attentionQueue,
  budgetStatus,
  capacityBoard,
  headline,
  liveOperations,
  qualityReport,
  scheduleBoard,
  usageBy,
  type OpsSession,
  type Outcome,
  type UsageRecord,
} from "../src/operations.ts";

const now = new Date("2026-11-10T12:00:00Z");
const session = (
  id: string,
  state: OpsSession["state"],
  idleMinutes: number,
): OpsSession => ({
  id,
  title: "Session " + id,
  owner: "engineer",
  state,
  stage: "tool",
  startedAt: "2026-11-10T10:00:00Z",
  lastActivityAt: new Date(now.getTime() - idleMinutes * 60000).toISOString(),
  nextAction: null,
});

it("counts sessions by state and lists stuck, blocked and failed work first", () => {
  const live = liveOperations(
    [
      session("done", "completed", 1),
      session("busy", "active", 2),
      session("silent", "active", 45),
      session("blocked", "blocked", 5),
      session("queued", "queued", 0),
      session("failed", "failed", 3),
    ],
    now,
  );
  expect(live.counts).toEqual({
    active: 2,
    queued: 1,
    waiting: 0,
    blocked: 1,
    completed: 1,
    failed: 1,
    cancelled: 0,
  });
  expect(live.rows.map((r) => r.id)).toEqual([
    "silent",
    "blocked",
    "failed",
    "busy",
    "queued",
    "done",
  ]);
  expect(live.rows[0]).toMatchObject({
    stuck: true,
    durationMs: 7_200_000,
    idleMs: 2_700_000,
  });
  expect(live.rows[3]?.stuck).toBe(false);
});

it("ranks attention by severity, customer risk, impact and deadline, and limits actions to what is permitted", () => {
  const entry = (id: string, changes: object) => ({
    id,
    kind: "approval" as const,
    title: id,
    sessionId: "s",
    severity: 3,
    customerImpact: false,
    businessImpact: 0,
    raisedAt: "2026-11-10T11:00:00Z",
    ...changes,
  });
  const queue = attentionQueue(
    [
      entry("low", { severity: 4 }),
      entry("customer", { kind: "customer_issue", customerImpact: true }),
      entry("critical", { kind: "failure", severity: 1 }),
      entry("overdue", { deadlineAt: "2026-11-10T11:30:00Z" }),
      entry("soon", { deadlineAt: "2026-11-10T12:30:00Z" }),
      entry("older-tie", { raisedAt: "2026-11-10T09:00:00Z" }),
    ],
    now,
    ["approve", "pause", "resume"],
  );
  expect(queue.map((q) => q.id)).toEqual([
    "critical",
    "customer",
    "overdue",
    "soon",
    "older-tie",
    "low",
  ]);
  expect(queue.find((q) => q.id === "overdue")).toMatchObject({
    overdue: true,
    actions: ["approve"],
  });
  expect(queue.find((q) => q.id === "critical")?.actions).toEqual(["resume"]);
  expect(queue.find((q) => q.id === "customer")?.actions).toEqual(["pause"]);
});

it("flags failing, missed and delayed schedules ahead of healthy ones", () => {
  const task = (name: string, nextAt: string | null, failures = 0) => ({
    id: name,
    name,
    owner: "ops",
    schedule: "Daily 09:00",
    nextAt,
    lastRunAt: null,
    lastSuccessAt: null,
    consecutiveFailures: failures,
  });
  const board = scheduleBoard(
    [
      task("later", "2026-11-10T15:00:00Z"),
      task("late", "2026-11-10T11:50:00Z"),
      task("missed", "2026-11-10T09:00:00Z"),
      task("failing", "2026-11-10T15:00:00Z", 3),
      task("off", null),
    ],
    now,
  );
  expect(board.map((r) => [r.name, r.health])).toEqual([
    ["failing", "failing"],
    ["missed", "missed"],
    ["late", "delayed"],
    ["later", "on_time"],
    ["off", "paused"],
  ]);
  expect(board[1]?.lateByMs).toBe(3 * 3_600_000);
});

it("explains waiting caused by a limit as a limit, not a failure", () => {
  const board = capacityBoard([
    { name: "Workers", kind: "concurrency", used: 2, limit: 8, waiting: 0 },
    {
      name: "Claude",
      kind: "provider_rate",
      used: 100,
      limit: 100,
      waiting: 3,
      resetsAt: "14:00",
    },
    { name: "Codex", kind: "provider_rate", used: 85, limit: 100, waiting: 0 },
    { name: "Broken", kind: "resource", used: 0, limit: 0, waiting: 0 },
  ]);
  expect(board.map((r) => [r.name, r.level])).toEqual([
    ["Broken", "at_limit"],
    ["Claude", "at_limit"],
    ["Codex", "tight"],
    ["Workers", "ok"],
  ]);
  expect(board[1]?.explanation).toBe(
    "3 waiting on the Claude limit, not because anything failed; resets 14:00",
  );
  expect(board[3]?.explanation).toBe("Within limits");
});

it("groups usage by any dimension and by day within a window", () => {
  const record = (
    at: string,
    agent: string,
    cost: number,
    extra: Partial<UsageRecord> = {},
  ): UsageRecord => ({
    at,
    agent,
    tokens: cost * 10,
    costMicros: cost,
    durationMs: 1000,
    ...extra,
  });
  const records = [
    record("2026-11-09T10:00:00Z", "eng", 5, {
      model: "sonnet",
      customer: "Acme",
    }),
    record("2026-11-10T10:00:00Z", "eng", 7, { model: "opus" }),
    record("2026-11-10T11:00:00Z", "qa", 20, {
      model: "sonnet",
      customer: "Acme",
    }),
  ];
  expect(usageBy(records, "agent")).toEqual([
    { key: "qa", runs: 1, tokens: 200, costMicros: 20, durationMs: 1000 },
    { key: "eng", runs: 2, tokens: 120, costMicros: 12, durationMs: 2000 },
  ]);
  expect(
    usageBy(records, "customer").map((g) => [g.key, g.costMicros]),
  ).toEqual([
    ["Acme", 25],
    ["Unassigned", 7],
  ]);
  expect(usageBy(records, "day").map((g) => [g.key, g.costMicros])).toEqual([
    ["2026-11-09", 5],
    ["2026-11-10", 27],
  ]);
  expect(
    usageBy(records, "model", { from: "2026-11-10T00:00:00Z" }).map(
      (g) => g.key,
    ),
  ).toEqual(["sonnet", "opus"]);
  expect(
    usageBy(records, "agent", { to: "2026-11-09T23:59:59Z" }),
  ).toHaveLength(1);
});

it("warns from a forecast before the budget is reached", () => {
  const period = { start: "2026-11-01T00:00:00Z", end: "2026-12-01T00:00:00Z" };
  const tenth = new Date("2026-11-04T00:00:00Z");
  expect(budgetStatus(1_000_000, 20_000_000, period, tenth)).toMatchObject({
    level: "ok",
    forecastMicros: 10_000_000,
  });
  expect(budgetStatus(3_000_000, 20_000_000, period, tenth)).toMatchObject({
    level: "over_forecast",
    message: "On course for 30.00 against a budget of 20.00",
  });
  expect(budgetStatus(17_000_000, 20_000_000, period, tenth)).toMatchObject({
    level: "warning",
    message: "85% of budget used",
  });
  expect(budgetStatus(21_000_000, 20_000_000, period, tenth).level).toBe(
    "exceeded",
  );
  expect(
    budgetStatus(5, 100, period, new Date("2026-10-01T00:00:00Z"))
      .forecastMicros,
  ).toBe(5);
});

it("reports quality rates with filters and links failures to their sessions", () => {
  const outcome = (
    id: string,
    result: Outcome["result"],
    changes: Partial<Outcome> = {},
  ): Outcome => ({
    sessionId: id,
    at: "2026-11-10T10:00:00Z",
    result,
    retries: 0,
    humanInterventions: 0,
    approvalsRequested: 1,
    approvalsGranted: 1,
    resolutionMs: 1000,
    ...changes,
  });
  const outcomes = [
    outcome("a", "success", { agent: "eng", resolutionMs: 1000 }),
    outcome("b", "success", { agent: "eng", retries: 2, resolutionMs: 3000 }),
    outcome("c", "failure", {
      agent: "qa",
      retries: 1,
      humanInterventions: 1,
      approvalsGranted: 0,
      resolutionMs: 9000,
      at: "2026-11-10T11:00:00Z",
    }),
    outcome("d", "failure", {
      agent: "eng",
      approvalsRequested: 0,
      approvalsGranted: 0,
      resolutionMs: 5000,
    }),
  ];
  const report = qualityReport(outcomes);
  expect(report).toMatchObject({
    sessions: 4,
    successRate: 0.5,
    failureRate: 0.5,
    retryRate: 0.5,
    interventionRate: 0.25,
    medianResolutionMs: 4000,
  });
  expect(report.approvalRate).toBeCloseTo(2 / 3);
  expect(report.failures).toEqual([
    {
      sessionId: "c",
      at: "2026-11-10T11:00:00Z",
      remediation: "Retried without success: open the trajectory and reassign",
    },
    {
      sessionId: "d",
      at: "2026-11-10T10:00:00Z",
      remediation: "Open the trajectory and retry",
    },
  ]);
  expect(qualityReport(outcomes, { agent: "qa" })).toMatchObject({
    sessions: 1,
    successRate: 0,
    medianResolutionMs: 9000,
  });
  expect(qualityReport(outcomes, { agent: "nobody" })).toMatchObject({
    sessions: 0,
    successRate: null,
    approvalRate: null,
    medianResolutionMs: null,
  });
  const live = liveOperations(
    [
      session("x", "completed", 1),
      session("y", "active", 50),
      session("z", "blocked", 1),
    ],
    now,
  );
  expect(
    headline(live, attentionQueue([], now), capacityBoard([]), report),
  ).toEqual({
    now: "1 active · 0 queued · 0 waiting",
    attention: "Nothing needs you",
    risk: "1 blocked · 1 stuck",
    accomplished: "1 completed · 50% success",
  });
});
