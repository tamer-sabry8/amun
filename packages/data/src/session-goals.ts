import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  blockedSummary,
  evaluateTurn,
  validateGoal,
  type BlockReason,
  type Criterion,
  type GoalState,
  type Guardrails,
  type TurnInput,
  type Verdict,
} from "../../domain/src/session-goals.ts";

export interface SessionGoal {
  id: string;
  sessionRef: string;
  title: string;
  criteria: Criterion[];
  guardrails: Guardrails;
  state: GoalState;
  turns: number;
  spentMicros: number;
  blockedReason: BlockReason | null;
  /** Result of the latest turn, with the summary shown when blocked. */
  last: { verdict?: Verdict; attempts?: string[]; summary?: string };
  notifiedAt: string | null;
}

interface Row {
  id: string;
  session_ref: string;
  title: string;
  criteria_json: string;
  max_turns: number;
  budget_micros: number | null;
  deadline_at: string | null;
  state: GoalState;
  turns: number;
  spent_micros: number;
  last_json: string;
  blocked_reason: BlockReason | null;
  notified_at: string | null;
}

function toGoal(row: Row): SessionGoal {
  return {
    id: row.id,
    sessionRef: row.session_ref,
    title: row.title,
    criteria: JSON.parse(row.criteria_json) as Criterion[],
    guardrails: {
      maxTurns: row.max_turns,
      ...(row.budget_micros !== null
        ? { budgetMicros: row.budget_micros }
        : {}),
      ...(row.deadline_at !== null ? { deadlineAt: row.deadline_at } : {}),
    },
    state: row.state,
    turns: row.turns,
    spentMicros: row.spent_micros,
    blockedReason: row.blocked_reason,
    last: JSON.parse(row.last_json) as SessionGoal["last"],
    notifiedAt: row.notified_at,
  };
}

/**
 * Stores each goal and its progress, so the verification loop survives a
 * closed window or a restart and continues from the recorded turn.
 */
export class SessionGoals {
  private readonly db: Database.Database;
  private readonly now: () => Date;
  constructor(db: Database.Database, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
  }

  create(input: {
    sessionRef: string;
    title: string;
    criteria: readonly Criterion[];
    guardrails: Guardrails;
  }): SessionGoal {
    const problems = validateGoal(input.criteria, input.guardrails);
    if (!input.title.trim()) problems.push("Name the goal");
    if (!input.sessionRef.trim()) problems.push("Attach the goal to a session");
    if (problems.length) throw Error(problems.join("; "));
    const id = randomUUID();
    const at = this.now().toISOString();
    this.db
      .prepare(
        `INSERT INTO session_goals(id,session_ref,title,criteria_json,max_turns,budget_micros,deadline_at,state,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,'running',?,?)`,
      )
      .run(
        id,
        input.sessionRef,
        input.title.trim(),
        JSON.stringify(input.criteria),
        input.guardrails.maxTurns,
        input.guardrails.budgetMicros ?? null,
        input.guardrails.deadlineAt ?? null,
        at,
        at,
      );
    return this.goal(id);
  }

  goal(id: string): SessionGoal {
    const row = this.db
      .prepare("SELECT * FROM session_goals WHERE id=?")
      .get(id) as Row | undefined;
    if (!row) throw Error("Unknown session goal");
    return toGoal(row);
  }

  /** Goals still being worked on; what a daemon resumes after a restart. */
  running(): SessionGoal[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM session_goals WHERE state='running' ORDER BY created_at,rowid",
        )
        .all() as Row[]
    ).map(toGoal);
  }

  /**
   * Records the checks run after a turn and returns what to do next: the
   * feedback to send the agent, or null when the goal is met or blocked.
   */
  recordTurn(
    id: string,
    turn: TurnInput,
  ): { goal: SessionGoal; feedback: string | null } {
    return this.db
      .transaction(() => {
        const goal = this.goal(id);
        if (goal.state !== "running")
          throw Error("This goal is no longer running");
        const turns = goal.turns + 1;
        const spent = goal.spentMicros + (turn.costMicros ?? 0);
        const verdict = evaluateTurn(
          goal.criteria,
          goal.guardrails,
          { turns, spentMicros: spent },
          turn,
          this.now(),
        );
        const attempts = [
          ...(goal.last.attempts ?? []),
          ...(turn.attempted?.trim()
            ? [turn.attempted.trim().slice(0, 300)]
            : []),
        ].slice(-20);
        const summary =
          verdict.state === "blocked"
            ? blockedSummary(
                goal.criteria,
                verdict,
                attempts,
                turn.agentBlocked?.question,
              )
            : verdict.state === "satisfied"
              ? `Goal met after ${turns} turn${turns === 1 ? "" : "s"}: every criterion passes.`
              : undefined;
        this.db
          .prepare(
            "UPDATE session_goals SET state=?,turns=?,spent_micros=?,last_json=?,blocked_reason=?,updated_at=? WHERE id=?",
          )
          .run(
            verdict.state,
            turns,
            spent,
            JSON.stringify({
              verdict,
              attempts,
              ...(summary ? { summary } : {}),
            }),
            verdict.state === "blocked" ? verdict.reason : null,
            this.now().toISOString(),
            id,
          );
        return { goal: this.goal(id), feedback: verdict.feedback };
      })
      .immediate();
  }

  /** A person lifts a block, optionally raising limits, and the loop resumes. */
  resume(id: string, changes: Partial<Guardrails> = {}): SessionGoal {
    const goal = this.goal(id);
    if (goal.state !== "blocked")
      throw Error("Only a blocked goal can be resumed");
    const guardrails = { ...goal.guardrails, ...changes };
    const problems = validateGoal(goal.criteria, guardrails);
    if (problems.length) throw Error(problems.join("; "));
    if (
      goal.blockedReason === "turn_limit" &&
      guardrails.maxTurns <= goal.turns
    )
      throw Error("Raise the turn limit above the turns already used");
    if (
      goal.blockedReason === "budget" &&
      guardrails.budgetMicros !== undefined &&
      guardrails.budgetMicros <= goal.spentMicros
    )
      throw Error("Raise the budget above what was already spent");
    this.db
      .prepare(
        "UPDATE session_goals SET state='running',blocked_reason=NULL,notified_at=NULL,max_turns=?,budget_micros=?,deadline_at=?,updated_at=? WHERE id=?",
      )
      .run(
        guardrails.maxTurns,
        guardrails.budgetMicros ?? null,
        guardrails.deadlineAt ?? null,
        this.now().toISOString(),
        id,
      );
    return this.goal(id);
  }

  cancel(id: string): SessionGoal {
    const goal = this.goal(id);
    if (goal.state === "satisfied") throw Error("This goal is already met");
    this.db
      .prepare(
        "UPDATE session_goals SET state='cancelled',blocked_reason=NULL,updated_at=? WHERE id=?",
      )
      .run(this.now().toISOString(), id);
    return this.goal(id);
  }

  /**
   * Goals that finished or blocked and have not been announced. Each is
   * returned once, so a notification is sent exactly one time.
   */
  takeNotifications(): { goal: SessionGoal; message: string }[] {
    return this.db
      .transaction(() => {
        const rows = this.db
          .prepare(
            "SELECT * FROM session_goals WHERE state IN ('satisfied','blocked') AND notified_at IS NULL ORDER BY updated_at,rowid",
          )
          .all() as Row[];
        const at = this.now().toISOString();
        return rows.map((row) => {
          this.db
            .prepare("UPDATE session_goals SET notified_at=? WHERE id=?")
            .run(at, row.id);
          const goal = toGoal(row);
          return {
            goal,
            message: goal.title + " · " + (goal.last.summary ?? goal.state),
          };
        });
      })
      .immediate();
  }
}
