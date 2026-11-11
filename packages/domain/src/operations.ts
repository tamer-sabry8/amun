/**
 * Operational dashboard: pure summaries over agent activity that answer
 * what is happening, what needs attention, what is at risk and what was
 * accomplished. Callers supply the records; nothing here reads storage.
 */

export const sessionStates = [
  "active",
  "queued",
  "waiting",
  "blocked",
  "completed",
  "failed",
  "cancelled",
] as const;
export type OpsSessionState = (typeof sessionStates)[number];

export interface OpsSession {
  id: string;
  title: string;
  owner: string;
  state: OpsSessionState;
  stage: string;
  startedAt: string;
  lastActivityAt: string;
  nextAction: string | null;
}

export interface LiveRow extends OpsSession {
  durationMs: number;
  idleMs: number;
  /** Active but silent for longer than the stuck threshold. */
  stuck: boolean;
}

export interface LiveOperations {
  counts: Record<OpsSessionState, number>;
  rows: LiveRow[];
}

export const stuckAfterMs = 20 * 60 * 1000;

/** Sessions with running time and idleness, unfinished and stuck first. */
export function liveOperations(
  sessions: readonly OpsSession[],
  now: Date,
  stuckMs = stuckAfterMs,
): LiveOperations {
  const counts = Object.fromEntries(sessionStates.map((s) => [s, 0])) as Record<
    OpsSessionState,
    number
  >;
  const at = now.getTime();
  const rows = sessions.map((session): LiveRow => {
    counts[session.state] += 1;
    const idleMs = Math.max(0, at - Date.parse(session.lastActivityAt));
    return {
      ...session,
      durationMs: Math.max(0, at - Date.parse(session.startedAt)),
      idleMs,
      stuck: session.state === "active" && idleMs >= stuckMs,
    };
  });
  const rank = (row: LiveRow) =>
    row.stuck
      ? 0
      : [
          "blocked",
          "failed",
          "waiting",
          "active",
          "queued",
          "completed",
          "cancelled",
        ].indexOf(row.state) + 1;
  rows.sort(
    (a, b) =>
      rank(a) - rank(b) || b.idleMs - a.idleMs || a.id.localeCompare(b.id),
  );
  return { counts, rows };
}

export const attentionKinds = [
  "approval",
  "escalation",
  "failure",
  "stuck",
  "policy_violation",
  "budget_warning",
  "customer_issue",
] as const;
export type AttentionKind = (typeof attentionKinds)[number];

export type OperatorAction =
  "approve" | "reject" | "reassign" | "pause" | "resume" | "cancel";

export interface AttentionEntry {
  id: string;
  kind: AttentionKind;
  title: string;
  sessionId: string | null;
  /** 1 is critical, 4 is low. */
  severity: number;
  customerImpact: boolean;
  /** Business impact from 0 (none) to 3 (high). */
  businessImpact: number;
  deadlineAt?: string;
  raisedAt: string;
}

const actionsFor: Record<AttentionKind, readonly OperatorAction[]> = {
  approval: ["approve", "reject"],
  escalation: ["reassign", "pause", "cancel"],
  failure: ["resume", "reassign", "cancel"],
  stuck: ["resume", "pause", "reassign", "cancel"],
  policy_violation: ["pause", "cancel"],
  budget_warning: ["pause", "resume"],
  customer_issue: ["reassign", "pause"],
};

export interface RankedAttention extends AttentionEntry {
  score: number;
  overdue: boolean;
  /** What an operator may do, limited to what they are permitted. */
  actions: OperatorAction[];
}

/**
 * Orders the queue by severity, customer risk, business impact and
 * deadline. An item past its deadline outranks one of equal weight.
 */
export function attentionQueue(
  entries: readonly AttentionEntry[],
  now: Date,
  permitted: readonly OperatorAction[] = [
    "approve",
    "reject",
    "reassign",
    "pause",
    "resume",
    "cancel",
  ],
): RankedAttention[] {
  const at = now.getTime();
  return entries
    .map((entry): RankedAttention => {
      const due = entry.deadlineAt ? Date.parse(entry.deadlineAt) - at : null;
      const overdue = due !== null && due <= 0;
      const urgency =
        due === null
          ? 0
          : overdue
            ? 30
            : due < 3_600_000
              ? 20
              : due < 86_400_000
                ? 10
                : 0;
      return {
        ...entry,
        overdue,
        score:
          (5 - Math.max(1, Math.min(4, entry.severity))) * 25 +
          (entry.customerImpact ? 40 : 0) +
          Math.max(0, Math.min(3, entry.businessImpact)) * 10 +
          urgency,
        actions: actionsFor[entry.kind].filter((action) =>
          permitted.includes(action),
        ),
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        Date.parse(a.raisedAt) - Date.parse(b.raisedAt) ||
        a.id.localeCompare(b.id),
    );
}

export interface ScheduledTask {
  id: string;
  name: string;
  owner: string;
  /** Human-readable schedule, for example "Weekdays 09:00". */
  schedule: string;
  nextAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  dependsOn?: readonly string[];
}

export type ScheduleHealth =
  "on_time" | "delayed" | "missed" | "failing" | "paused";

export interface ScheduleRow extends ScheduledTask {
  health: ScheduleHealth;
  lateByMs: number;
}

export const missedAfterMs = 60 * 60 * 1000;

/** Scheduled work with failing, missed and delayed runs listed first. */
export function scheduleBoard(
  tasks: readonly ScheduledTask[],
  now: Date,
): ScheduleRow[] {
  const at = now.getTime();
  const order: ScheduleHealth[] = [
    "failing",
    "missed",
    "delayed",
    "on_time",
    "paused",
  ];
  return tasks
    .map((task): ScheduleRow => {
      const lateByMs = task.nextAt
        ? Math.max(0, at - Date.parse(task.nextAt))
        : 0;
      const health: ScheduleHealth =
        task.nextAt === null
          ? "paused"
          : task.consecutiveFailures >= 2
            ? "failing"
            : lateByMs >= missedAfterMs
              ? "missed"
              : lateByMs > 0
                ? "delayed"
                : "on_time";
      return { ...task, health, lateByMs };
    })
    .sort(
      (a, b) =>
        order.indexOf(a.health) - order.indexOf(b.health) ||
        b.lateByMs - a.lateByMs ||
        a.name.localeCompare(b.name),
    );
}

export interface LimitReading {
  name: string;
  kind: "provider_rate" | "concurrency" | "queue" | "resource";
  used: number;
  limit: number;
  /** Work waiting only because of this limit. */
  waiting: number;
  resetsAt?: string;
}

export interface CapacityRow extends LimitReading {
  /** Share of the limit in use, from 0 to 1 or above. */
  pressure: number;
  level: "ok" | "tight" | "at_limit";
  explanation: string;
}

/** Limits with the most constrained first, and a plain reason for waiting. */
export function capacityBoard(
  readings: readonly LimitReading[],
): CapacityRow[] {
  return readings
    .map((reading): CapacityRow => {
      const pressure = reading.limit > 0 ? reading.used / reading.limit : 1;
      const level =
        pressure >= 1 ? "at_limit" : pressure >= 0.8 ? "tight" : "ok";
      return {
        ...reading,
        pressure,
        level,
        explanation:
          reading.waiting > 0
            ? `${reading.waiting} waiting on the ${reading.name} limit, not because anything failed` +
              (reading.resetsAt ? `; resets ${reading.resetsAt}` : "")
            : level === "ok"
              ? "Within limits"
              : "Close to the limit; new work may wait",
      };
    })
    .sort((a, b) => b.pressure - a.pressure || a.name.localeCompare(b.name));
}

export interface UsageRecord {
  at: string;
  agent: string;
  team?: string;
  customer?: string;
  project?: string;
  workflow?: string;
  model?: string;
  connector?: string;
  tokens: number;
  costMicros: number;
  durationMs: number;
}

export const usageDimensions = [
  "agent",
  "team",
  "customer",
  "project",
  "workflow",
  "model",
  "connector",
  "day",
] as const;
export type UsageDimension = (typeof usageDimensions)[number];

export interface UsageGroup {
  key: string;
  runs: number;
  tokens: number;
  costMicros: number;
  durationMs: number;
}

/** Totals by one dimension, most costly first. Missing values group as "Unassigned". */
export function usageBy(
  records: readonly UsageRecord[],
  dimension: UsageDimension,
  window: { from?: string; to?: string } = {},
): UsageGroup[] {
  const groups = new Map<string, UsageGroup>();
  for (const record of records) {
    if (window.from !== undefined && record.at < window.from) continue;
    if (window.to !== undefined && record.at > window.to) continue;
    const key =
      dimension === "day"
        ? record.at.slice(0, 10)
        : (record[dimension] ?? "Unassigned");
    const group = groups.get(key) ?? {
      key,
      runs: 0,
      tokens: 0,
      costMicros: 0,
      durationMs: 0,
    };
    group.runs += 1;
    group.tokens += record.tokens;
    group.costMicros += record.costMicros;
    group.durationMs += record.durationMs;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) =>
    dimension === "day"
      ? a.key.localeCompare(b.key)
      : b.costMicros - a.costMicros || a.key.localeCompare(b.key),
  );
}

export interface BudgetStatus {
  spentMicros: number;
  budgetMicros: number;
  /** Projected spend at the end of the period at the current rate. */
  forecastMicros: number;
  level: "ok" | "warning" | "over_forecast" | "exceeded";
  message: string;
}

/**
 * Spend against a budget with a straight-line forecast, so a warning comes
 * before the limit is reached rather than after.
 */
export function budgetStatus(
  spentMicros: number,
  budgetMicros: number,
  period: { start: string; end: string },
  now: Date,
  warnAt = 0.8,
): BudgetStatus {
  const start = Date.parse(period.start);
  const end = Date.parse(period.end);
  const elapsed = Math.min(Math.max(now.getTime() - start, 0), end - start);
  const forecastMicros =
    elapsed <= 0
      ? spentMicros
      : Math.round((spentMicros / elapsed) * (end - start));
  const level =
    spentMicros >= budgetMicros
      ? "exceeded"
      : spentMicros >= budgetMicros * warnAt
        ? "warning"
        : forecastMicros > budgetMicros
          ? "over_forecast"
          : "ok";
  const money = (micros: number) => (micros / 1_000_000).toFixed(2);
  return {
    spentMicros,
    budgetMicros,
    forecastMicros,
    level,
    message: {
      exceeded: `Budget reached: ${money(spentMicros)} of ${money(budgetMicros)}`,
      warning: `${Math.round((spentMicros / budgetMicros) * 100)}% of budget used`,
      over_forecast: `On course for ${money(forecastMicros)} against a budget of ${money(budgetMicros)}`,
      ok: `${money(spentMicros)} of ${money(budgetMicros)} used`,
    }[level],
  };
}

export interface Outcome {
  sessionId: string;
  at: string;
  result: "success" | "failure";
  workflow?: string;
  agent?: string;
  customer?: string;
  model?: string;
  retries: number;
  humanInterventions: number;
  approvalsRequested: number;
  approvalsGranted: number;
  /** Time from start to resolution. */
  resolutionMs: number;
}

export interface QualityFilter {
  workflow?: string;
  agent?: string;
  customer?: string;
  model?: string;
  from?: string;
  to?: string;
}

export interface QualityReport {
  sessions: number;
  successRate: number | null;
  failureRate: number | null;
  /** Share of sessions that needed at least one retry. */
  retryRate: number | null;
  /** Share of sessions a person had to step into. */
  interventionRate: number | null;
  /** Share of approval requests that were granted. */
  approvalRate: number | null;
  medianResolutionMs: number | null;
  /** Failed sessions, newest first, to open their trajectory. */
  failures: { sessionId: string; at: string; remediation: string }[];
}

export function qualityReport(
  outcomes: readonly Outcome[],
  filter: QualityFilter = {},
): QualityReport {
  const rows = outcomes.filter(
    (o) =>
      (filter.workflow === undefined || o.workflow === filter.workflow) &&
      (filter.agent === undefined || o.agent === filter.agent) &&
      (filter.customer === undefined || o.customer === filter.customer) &&
      (filter.model === undefined || o.model === filter.model) &&
      (filter.from === undefined || o.at >= filter.from) &&
      (filter.to === undefined || o.at <= filter.to),
  );
  const n = rows.length;
  const share = (count: number) => (n === 0 ? null : count / n);
  const requested = rows.reduce((sum, o) => sum + o.approvalsRequested, 0);
  const granted = rows.reduce((sum, o) => sum + o.approvalsGranted, 0);
  const times = rows.map((o) => o.resolutionMs).sort((a, b) => a - b);
  const middle = Math.floor(times.length / 2);
  return {
    sessions: n,
    successRate: share(rows.filter((o) => o.result === "success").length),
    failureRate: share(rows.filter((o) => o.result === "failure").length),
    retryRate: share(rows.filter((o) => o.retries > 0).length),
    interventionRate: share(
      rows.filter((o) => o.humanInterventions > 0).length,
    ),
    approvalRate: requested === 0 ? null : granted / requested,
    medianResolutionMs:
      times.length === 0
        ? null
        : times.length % 2
          ? times[middle]!
          : (times[middle - 1]! + times[middle]!) / 2,
    failures: rows
      .filter((o) => o.result === "failure")
      .sort(
        (a, b) =>
          b.at.localeCompare(a.at) || a.sessionId.localeCompare(b.sessionId),
      )
      .map((o) => ({
        sessionId: o.sessionId,
        at: o.at,
        remediation:
          o.retries > 0
            ? "Retried without success: open the trajectory and reassign"
            : "Open the trajectory and retry",
      })),
  };
}

/** The four questions a control tower answers, in one line each. */
export function headline(
  live: LiveOperations,
  attention: readonly RankedAttention[],
  capacity: readonly CapacityRow[],
  quality: QualityReport,
): { now: string; attention: string; risk: string; accomplished: string } {
  const stuck = live.rows.filter((row) => row.stuck).length;
  const tight = capacity.filter((row) => row.level !== "ok").length;
  const overdue = attention.filter((item) => item.overdue).length;
  return {
    now: `${live.counts.active} active · ${live.counts.queued} queued · ${live.counts.waiting} waiting`,
    attention: attention.length
      ? `${attention.length} need you`
      : "Nothing needs you",
    risk:
      [
        live.counts.blocked ? `${live.counts.blocked} blocked` : "",
        stuck ? `${stuck} stuck` : "",
        overdue ? `${overdue} overdue` : "",
        tight ? `${tight} limits tight` : "",
      ]
        .filter(Boolean)
        .join(" · ") || "Nothing at risk",
    accomplished:
      `${live.counts.completed} completed` +
      (quality.successRate === null
        ? ""
        : ` · ${Math.round(quality.successRate * 100)}% success`),
  };
}
