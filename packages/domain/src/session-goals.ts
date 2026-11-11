/**
 * Session goals: a definition of done that is checked after every turn, so
 * an agent keeps working until the criteria hold, a guardrail stops it, or
 * it needs a person. The checks themselves are run by the caller.
 */

export interface Criterion {
  id: string;
  /** What must be true, in plain words. */
  description: string;
  /** The check to run, for example "pnpm test". Shown to the user. */
  check: string;
}

export interface Guardrails {
  maxTurns: number;
  budgetMicros?: number;
  /** ISO time after which the goal stops. */
  deadlineAt?: string;
}

export interface CriterionResult {
  id: string;
  passed: boolean;
  /** Output of the check: test errors, compiler log, failed links. */
  output: string;
}

export type GoalState = "running" | "satisfied" | "blocked" | "cancelled";

export type BlockReason =
  "turn_limit" | "budget" | "deadline" | "needs_decision" | "unresolvable";

export const blockLabels: Record<BlockReason, string> = {
  turn_limit: "Reached the turn limit",
  budget: "Reached the budget ceiling",
  deadline: "Ran out of time",
  needs_decision: "Needs a decision",
  unresolvable: "Cannot resolve a dependency",
};

export interface TurnInput {
  results: readonly CriterionResult[];
  costMicros?: number;
  /** Set by the agent when it cannot continue without a person. */
  agentBlocked?: {
    reason: "needs_decision" | "unresolvable";
    question: string;
  };
  /** One line on what the agent tried this turn. */
  attempted?: string;
}

export interface GoalProgress {
  turns: number;
  spentMicros: number;
}

export interface Verdict {
  state: GoalState;
  reason: BlockReason | null;
  passed: string[];
  failed: string[];
  /** Sent back to the agent when the loop continues. Null when it stops. */
  feedback: string | null;
}

const outputLimit = 4000;

export function validateGoal(
  criteria: readonly Criterion[],
  guardrails: Guardrails,
): string[] {
  const problems: string[] = [];
  if (criteria.length === 0) problems.push("Add at least one criterion");
  const ids = criteria.map((c) => c.id);
  if (new Set(ids).size !== ids.length)
    problems.push("Criterion ids must be unique");
  for (const c of criteria)
    if (!c.id.trim() || !c.description.trim() || !c.check.trim())
      problems.push("Every criterion needs an id, a description and a check");
  if (!Number.isInteger(guardrails.maxTurns) || guardrails.maxTurns < 1)
    problems.push("Set a turn limit of at least 1");
  if (
    guardrails.budgetMicros !== undefined &&
    (!Number.isSafeInteger(guardrails.budgetMicros) ||
      guardrails.budgetMicros < 0)
  )
    problems.push("The budget ceiling must be zero or more");
  if (
    guardrails.deadlineAt !== undefined &&
    Number.isNaN(Date.parse(guardrails.deadlineAt))
  )
    problems.push("The time limit must be a date and time");
  return problems;
}

/**
 * Decides what happens after a turn. Order matters: success is checked
 * first, so a goal met on its last allowed turn counts as met.
 */
export function evaluateTurn(
  criteria: readonly Criterion[],
  guardrails: Guardrails,
  progress: GoalProgress,
  turn: TurnInput,
  now: Date,
): Verdict {
  const byId = new Map(turn.results.map((result) => [result.id, result]));
  // A criterion with no reported result has not passed.
  const passed = criteria
    .filter((c) => byId.get(c.id)?.passed)
    .map((c) => c.id);
  const failed = criteria
    .filter((c) => !byId.get(c.id)?.passed)
    .map((c) => c.id);
  const stop = (reason: BlockReason): Verdict => ({
    state: "blocked",
    reason,
    passed,
    failed,
    feedback: null,
  });
  if (failed.length === 0)
    return { state: "satisfied", reason: null, passed, failed, feedback: null };
  if (turn.agentBlocked) return stop(turn.agentBlocked.reason);
  if (progress.turns >= guardrails.maxTurns) return stop("turn_limit");
  if (
    guardrails.budgetMicros !== undefined &&
    progress.spentMicros >= guardrails.budgetMicros
  )
    return stop("budget");
  if (
    guardrails.deadlineAt !== undefined &&
    now.getTime() >= Date.parse(guardrails.deadlineAt)
  )
    return stop("deadline");
  const feedback = [
    `${failed.length} of ${criteria.length} criteria are not met yet. Fix these and stop when every check passes.`,
    ...criteria
      .filter((c) => failed.includes(c.id))
      .flatMap((c) => {
        const output = byId.get(c.id)?.output.trim() ?? "";
        return [
          "",
          `Not met: ${c.description}`,
          `Check: ${c.check}`,
          output
            ? "Output:\n" + output.slice(-outputLimit)
            : "The check produced no result.",
        ];
      }),
  ].join("\n");
  return { state: "running", reason: null, passed, failed, feedback };
}

/** What a person reads when a goal stops short. */
export function blockedSummary(
  criteria: readonly Criterion[],
  verdict: Verdict,
  attempts: readonly string[],
  question?: string,
): string {
  const describe = (ids: readonly string[]) =>
    criteria.filter((c) => ids.includes(c.id)).map((c) => "- " + c.description);
  return [
    "Blocked — needs input: " +
      (verdict.reason ? blockLabels[verdict.reason] : "Stopped"),
    "",
    "Attempted:",
    ...(attempts.length
      ? attempts.map((a) => "- " + a)
      : ["- Nothing recorded"]),
    "",
    "Passed:",
    ...(verdict.passed.length ? describe(verdict.passed) : ["- None"]),
    "",
    "Still failing:",
    ...describe(verdict.failed),
    "",
    "Needed from you: " +
      (question?.trim() ||
        (verdict.reason === "turn_limit" ||
        verdict.reason === "budget" ||
        verdict.reason === "deadline"
          ? "Raise the limit, change the criteria, or stop here."
          : "A decision on how to proceed.")),
  ].join("\n");
}
