/**
 * Session trajectory: the ordered record of what an agent saw, decided and
 * did. These helpers are pure; storage and redaction live in the data layer.
 */

export const trajectorySources = [
  "user",
  "system",
  "reasoning",
  "tool",
  "context",
  "subagent",
  "approval",
  "error",
  "outcome",
] as const;
export type TrajectorySource = (typeof trajectorySources)[number];

export const sourceLabels: Record<TrajectorySource, string> = {
  user: "User input",
  system: "System policy",
  reasoning: "Model reasoning",
  tool: "Tool use",
  context: "Injected context",
  subagent: "Delegated work",
  approval: "Approval",
  error: "Error",
  outcome: "Outcome",
};

/** The question each source answers for a person reviewing a session. */
export const sourceQuestions: Record<TrajectorySource, string> = {
  user: "What was asked?",
  system: "What rules applied?",
  reasoning: "What did it decide?",
  tool: "What did it do?",
  context: "What did it see?",
  subagent: "What did it delegate?",
  approval: "Who allowed it?",
  error: "What went wrong?",
  outcome: "What changed as a result?",
};

export interface TrajectoryEvent {
  id: string;
  sessionId: string;
  seq: number;
  at: string;
  source: TrajectorySource;
  /** Finer type within the source, such as "request", "retry" or "result". */
  kind: string;
  /** Who produced the event: a person, Firstmate, a worker or a tool. */
  participant: string;
  summary: string;
  detail: unknown;
  /** The earlier event this one corrects, answers or follows up. */
  refersTo: string | null;
  status: string | null;
  tool: string | null;
  costMicros: number | null;
  durationMs: number | null;
}

export interface TrajectoryFilter {
  text?: string;
  sources?: readonly TrajectorySource[];
  kinds?: readonly string[];
  participants?: readonly string[];
  tools?: readonly string[];
  statuses?: readonly string[];
  /** Inclusive ISO timestamps. */
  from?: string;
  to?: string;
}

function has<T>(wanted: readonly T[] | undefined, value: T | null): boolean {
  return (
    wanted === undefined ||
    wanted.length === 0 ||
    (value !== null && wanted.includes(value))
  );
}

export function eventText(event: TrajectoryEvent): string {
  return [
    event.summary,
    event.kind,
    event.participant,
    event.tool ?? "",
    event.status ?? "",
    typeof event.detail === "string"
      ? event.detail
      : JSON.stringify(event.detail ?? ""),
  ]
    .join(" ")
    .toLowerCase();
}

/** Every word of the query must appear somewhere in the event. */
export function matchesEvent(
  event: TrajectoryEvent,
  filter: TrajectoryFilter,
): boolean {
  if (!has(filter.sources, event.source)) return false;
  if (!has(filter.kinds, event.kind)) return false;
  if (!has(filter.participants, event.participant)) return false;
  if (!has(filter.tools, event.tool)) return false;
  if (!has(filter.statuses, event.status)) return false;
  if (filter.from !== undefined && event.at < filter.from) return false;
  if (filter.to !== undefined && event.at > filter.to) return false;
  const words = (filter.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = eventText(event);
  return words.every((word) => text.includes(word));
}

export function filterEvents(
  events: readonly TrajectoryEvent[],
  filter: TrajectoryFilter,
): TrajectoryEvent[] {
  return events.filter((event) => matchesEvent(event, filter));
}

export interface TrajectoryGroup {
  source: TrajectorySource;
  label: string;
  events: TrajectoryEvent[];
}

/** Groups in a fixed source order, each keeping chronological order. */
export function groupBySource(
  events: readonly TrajectoryEvent[],
): TrajectoryGroup[] {
  return trajectorySources
    .map((source) => ({
      source,
      label: sourceLabels[source],
      events: events.filter((event) => event.source === source),
    }))
    .filter((group) => group.events.length > 0);
}

export interface EventContext {
  event: TrajectoryEvent;
  before: TrajectoryEvent[];
  after: TrajectoryEvent[];
  /** The event this one refers to, when it is in the same record. */
  refers: TrajectoryEvent | null;
  /** Later events that correct or follow up this one. */
  followUps: TrajectoryEvent[];
}

/** An event with its neighbours and the events linked to it. */
export function eventContext(
  events: readonly TrajectoryEvent[],
  id: string,
  span = 2,
): EventContext | null {
  const index = events.findIndex((event) => event.id === id);
  const event = events[index];
  if (!event) return null;
  return {
    event,
    before: events.slice(Math.max(0, index - span), index),
    after: events.slice(index + 1, index + 1 + span),
    refers: events.find((other) => other.id === event.refersTo) ?? null,
    followUps: events.filter((other) => other.refersTo === id),
  };
}

export type SessionState =
  "empty" | "in_progress" | "awaiting_approval" | "failed" | "completed";

export interface ResumeBrief {
  state: SessionState;
  /** Plain statements of what already happened, oldest first. */
  done: string[];
  /** Tool calls and delegations that have no recorded result. */
  incomplete: TrajectoryEvent[];
  /** Approval requests nobody has answered. */
  approvalsNeeded: TrajectoryEvent[];
  /** Errors that no later event addressed. */
  openErrors: TrajectoryEvent[];
  lastOutcome: TrajectoryEvent | null;
}

const starts = new Set(["call", "start", "dispatch"]);

/** What a person needs to know before continuing a recorded session. */
export function resumeBrief(events: readonly TrajectoryEvent[]): ResumeBrief {
  const answered = new Set(
    events.map((event) => event.refersTo).filter((id) => id !== null),
  );
  const incomplete = events.filter(
    (event) =>
      (event.source === "tool" || event.source === "subagent") &&
      starts.has(event.kind) &&
      !answered.has(event.id),
  );
  const approvalsNeeded = events.filter(
    (event) =>
      event.source === "approval" &&
      event.kind === "request" &&
      !answered.has(event.id),
  );
  const openErrors = events.filter(
    (event) => event.source === "error" && !answered.has(event.id),
  );
  const lastOutcome = events.findLast((e) => e.source === "outcome") ?? null;
  const last = events.at(-1);
  const state: SessionState =
    events.length === 0
      ? "empty"
      : approvalsNeeded.length > 0
        ? "awaiting_approval"
        : openErrors.length > 0
          ? "failed"
          : last?.source === "outcome" && incomplete.length === 0
            ? "completed"
            : "in_progress";
  return {
    state,
    done: events
      .filter(
        (event) =>
          event.source === "user" ||
          event.source === "outcome" ||
          (event.source === "approval" && event.kind !== "request"),
      )
      .map((event) => sourceLabels[event.source] + ": " + event.summary),
    incomplete,
    approvalsNeeded,
    openErrors,
    lastOutcome,
  };
}

export interface BranchSummary {
  sessionId: string;
  events: number;
  toolCalls: number;
  tools: string[];
  errors: number;
  costMicros: number;
  durationMs: number;
  state: SessionState;
  result: string | null;
}

/** The measures used to compare one branch of a session with another. */
export function summarizeBranch(
  sessionId: string,
  events: readonly TrajectoryEvent[],
): BranchSummary {
  const calls = events.filter(
    (event) => event.source === "tool" && starts.has(event.kind),
  );
  const brief = resumeBrief(events);
  return {
    sessionId,
    events: events.length,
    toolCalls: calls.length,
    tools: [
      ...new Set(calls.map((e) => e.tool).filter((t) => t !== null)),
    ].sort(),
    errors: events.filter((event) => event.source === "error").length,
    costMicros: events.reduce((sum, e) => sum + (e.costMicros ?? 0), 0),
    durationMs: events.reduce((sum, e) => sum + (e.durationMs ?? 0), 0),
    state: brief.state,
    result: brief.lastOutcome?.summary ?? null,
  };
}

export type ReplayMode = "reconstruction" | "re_execution";

export interface ReplayDifference {
  step: number;
  original: string | null;
  replay: string | null;
}

export interface ReplayComparison {
  mode: ReplayMode;
  /** True when the final recorded outcome matches the original. */
  reproduced: boolean;
  originalResult: string | null;
  replayResult: string | null;
  /** Steps whose action differs, by position among comparable events. */
  differences: ReplayDifference[];
  /** Recorded conditions that changed, such as the model or a tool version. */
  changedConditions: string[];
}

function step(event: TrajectoryEvent): string {
  return [event.source, event.kind, event.tool ?? "", event.summary].join(
    " | ",
  );
}

function comparable(events: readonly TrajectoryEvent[]): TrajectoryEvent[] {
  // Reasoning and timing vary run to run; actions and results are compared.
  return events.filter(
    (event) => event.source !== "reasoning" && event.source !== "context",
  );
}

/**
 * Compares a replay with its original. A reconstruction re-reads the stored
 * record, so any difference means the record was not reproduced faithfully. A
 * re-execution runs again and may legitimately differ.
 */
export function compareReplay(
  mode: ReplayMode,
  original: readonly TrajectoryEvent[],
  replay: readonly TrajectoryEvent[],
  conditions: {
    original: Readonly<Record<string, string>>;
    replay: Readonly<Record<string, string>>;
  } = { original: {}, replay: {} },
): ReplayComparison {
  const left = comparable(original);
  const right = comparable(replay);
  const differences: ReplayDifference[] = [];
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = left[index] ? step(left[index]!) : null;
    const b = right[index] ? step(right[index]!) : null;
    if (a !== b) differences.push({ step: index + 1, original: a, replay: b });
  }
  const originalResult = resumeBrief(original).lastOutcome?.summary ?? null;
  const replayResult = resumeBrief(replay).lastOutcome?.summary ?? null;
  const keys = new Set([
    ...Object.keys(conditions.original),
    ...Object.keys(conditions.replay),
  ]);
  return {
    mode,
    reproduced: originalResult !== null && originalResult === replayResult,
    originalResult,
    replayResult,
    differences,
    changedConditions: [...keys]
      .filter((key) => conditions.original[key] !== conditions.replay[key])
      .sort()
      .map(
        (key) =>
          `${key}: ${conditions.original[key] ?? "not recorded"} → ${conditions.replay[key] ?? "not recorded"}`,
      ),
  };
}
