import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { AgentOrg } from "./agent-org.ts";
import { managementChain } from "../../domain/src/agent-org.ts";

export const wakeTriggers = [
  "assignment",
  "message",
  "blocker_resolved",
  "schedule",
  "business_event",
  "human_request",
  "delegation",
  "escalation",
] as const;
export type WakeTrigger = (typeof wakeTriggers)[number];

export const wakeDecisions = [
  "act",
  "wait",
  "delegate",
  "escalate",
  "request_approval",
  "refused",
] as const;
export type WakeDecision = (typeof wakeDecisions)[number];

export const escalationReasons = [
  "authority",
  "information",
  "budget",
  "confidence",
] as const;
export type EscalationReason = (typeof escalationReasons)[number];

export interface Heartbeat {
  agentId: string;
  cadenceMinutes: number;
  nextAt: string;
  maxWakesPerHour: number;
  maxConsecutiveActs: number;
  /** Set when a person or a stop condition halted the agent. */
  haltedReason: string | null;
}

export interface Wake {
  id: string;
  agentId: string;
  at: string;
  trigger: WakeTrigger;
  /** Why the agent woke, in plain words. */
  reason: string;
  decision: WakeDecision;
  /** What it decided to do, or why it was refused. */
  detail: string;
  waitingOn: string | null;
  /** When it will next act on its own. */
  nextAt: string | null;
  /** The objective or goal the work traces back to. */
  objectiveRef: string | null;
  /** The agent or person delegated or escalated to. */
  counterpartId: string | null;
  parentWakeId: string | null;
}

/** What the agent chose after assessing its responsibilities. */
export type WakeChoice =
  | { decision: "act"; detail: string; costMicros?: number }
  | { decision: "wait"; detail: string; waitingOn: string }
  | { decision: "request_approval"; detail: string }
  | { decision: "delegate"; detail: string; to: string }
  | { decision: "escalate"; detail: string; because: EscalationReason };

interface HeartbeatRow {
  agent_id: string;
  cadence_minutes: number;
  next_at: string;
  max_wakes_per_hour: number;
  max_consecutive_acts: number;
  halted_reason: string | null;
}

interface WakeRow {
  id: string;
  agent_id: string;
  at: string;
  trigger_kind: WakeTrigger;
  reason: string;
  decision: WakeDecision;
  detail: string;
  waiting_on: string | null;
  next_at: string | null;
  objective_ref: string | null;
  counterpart_id: string | null;
  parent_wake_id: string | null;
}

function toHeartbeat(row: HeartbeatRow): Heartbeat {
  return {
    agentId: row.agent_id,
    cadenceMinutes: row.cadence_minutes,
    nextAt: row.next_at,
    maxWakesPerHour: row.max_wakes_per_hour,
    maxConsecutiveActs: row.max_consecutive_acts,
    haltedReason: row.halted_reason,
  };
}

function toWake(row: WakeRow): Wake {
  return {
    id: row.id,
    agentId: row.agent_id,
    at: row.at,
    trigger: row.trigger_kind,
    reason: row.reason,
    decision: row.decision,
    detail: row.detail,
    waitingOn: row.waiting_on,
    nextAt: row.next_at,
    objectiveRef: row.objective_ref,
    counterpartId: row.counterpart_id,
    parentWakeId: row.parent_wake_id,
  };
}

/**
 * Wakes agents on a cadence or on an event and records, for every wake, why
 * it happened, what was decided, what the agent is waiting on and when it
 * acts next. Stop conditions are checked before any decision is accepted.
 */
export class Heartbeats {
  private readonly db: Database.Database;
  private readonly org: AgentOrg;
  private readonly now: () => Date;
  constructor(db: Database.Database, now: () => Date = () => new Date()) {
    this.db = db;
    this.org = new AgentOrg(db);
    this.now = now;
  }

  /** Sets how often an agent checks for work and its runaway limits. */
  configure(
    agentId: string,
    cadenceMinutes: number,
    limits: { maxWakesPerHour?: number; maxConsecutiveActs?: number } = {},
  ): Heartbeat {
    this.org.agent(agentId);
    const perHour = limits.maxWakesPerHour ?? 12;
    const acts = limits.maxConsecutiveActs ?? 20;
    for (const value of [cadenceMinutes, perHour, acts])
      if (!Number.isSafeInteger(value) || value < 1)
        throw Error("Heartbeat settings must be whole numbers of at least 1");
    this.db
      .prepare(
        `INSERT INTO agent_heartbeats(agent_id,cadence_minutes,next_at,max_wakes_per_hour,max_consecutive_acts) VALUES (?,?,?,?,?)
         ON CONFLICT(agent_id) DO UPDATE SET cadence_minutes=excluded.cadence_minutes,next_at=excluded.next_at,
           max_wakes_per_hour=excluded.max_wakes_per_hour,max_consecutive_acts=excluded.max_consecutive_acts`,
      )
      .run(agentId, cadenceMinutes, this.after(cadenceMinutes), perHour, acts);
    return this.heartbeat(agentId);
  }

  heartbeat(agentId: string): Heartbeat {
    const row = this.db
      .prepare("SELECT * FROM agent_heartbeats WHERE agent_id=?")
      .get(agentId) as HeartbeatRow | undefined;
    if (!row) throw Error("This agent has no heartbeat");
    return toHeartbeat(row);
  }

  /** Agents whose scheduled heartbeat has arrived and that are not halted. */
  due(): Heartbeat[] {
    const rows = this.db
      .prepare(
        `SELECT h.* FROM agent_heartbeats h JOIN agents a ON a.id=h.agent_id
         WHERE h.next_at<=? AND h.halted_reason IS NULL AND a.status NOT IN ('paused','retired')
         ORDER BY h.next_at,h.agent_id`,
      )
      .all(this.now().toISOString()) as HeartbeatRow[];
    return rows.map(toHeartbeat);
  }

  /**
   * Records one wake. `choose` is the agent's assessment; it is not called
   * when a stop condition already refuses the wake. A person asking for
   * status is always answered, even for a halted agent.
   */
  wake(
    agentId: string,
    trigger: WakeTrigger,
    reason: string,
    choose: () => WakeChoice,
    context: { objectiveRef?: string; parentWakeId?: string } = {},
  ): Wake {
    if (!wakeTriggers.includes(trigger)) throw Error("Unknown wake trigger");
    if (!reason.trim()) throw Error("Say why the agent is being woken");
    return this.db
      .transaction(() => {
        const heartbeat = this.heartbeat(agentId);
        const stop = this.stopCondition(heartbeat, trigger);
        if (stop) return this.record(agentId, trigger, reason, context, stop);
        const choice = choose();
        if (!choice.detail.trim())
          throw Error("A wake decision needs an explanation");
        if (choice.decision === "act") {
          const refusals = this.org.refusals(agentId, {
            at: this.now(),
            ...(choice.costMicros !== undefined
              ? { costMicros: choice.costMicros }
              : {}),
          });
          if (refusals.length > 0)
            return this.record(agentId, trigger, reason, context, {
              decision: "refused",
              detail: "Not allowed: " + refusals.join(", "),
              waitingOn: refusals.includes("over_budget")
                ? "budget"
                : "a person",
            });
          if (this.consecutiveActs(agentId) >= heartbeat.maxConsecutiveActs) {
            this.halt(agentId, "system", "Too many actions without a pause");
            return this.record(agentId, trigger, reason, context, {
              decision: "refused",
              detail: "Halted after too many actions without a pause",
              waitingOn: "a person",
            });
          }
          return this.record(agentId, trigger, reason, context, {
            decision: "act",
            detail: choice.detail,
          });
        }
        if (choice.decision === "wait")
          return this.record(agentId, trigger, reason, context, {
            decision: "wait",
            detail: choice.detail,
            waitingOn: choice.waitingOn,
          });
        if (choice.decision === "request_approval")
          return this.record(agentId, trigger, reason, context, {
            decision: "request_approval",
            detail: choice.detail,
            waitingOn: "approval",
          });
        if (choice.decision === "delegate") {
          const target = this.org.agent(choice.to);
          if (target.id === agentId)
            throw Error("An agent cannot delegate to itself");
          const wake = this.record(agentId, trigger, reason, context, {
            decision: "delegate",
            detail: choice.detail,
            waitingOn: target.displayName,
            counterpartId: target.id,
          });
          if (this.hasHeartbeat(target.id))
            this.setNext(target.id, this.now().toISOString());
          return wake;
        }
        const agents = this.org.agents();
        const manager = managementChain(agents, agentId)[0];
        const self = this.org.agent(agentId);
        const to =
          self.escalation ?? manager?.id ?? self.accountableOwner ?? "owner";
        const wake = this.record(agentId, trigger, reason, context, {
          decision: "escalate",
          detail: `Lacks ${choice.because}: ${choice.detail}`,
          waitingOn: to,
          counterpartId: to,
        });
        if (this.hasHeartbeat(to)) this.setNext(to, this.now().toISOString());
        return wake;
      })
      .immediate();
  }

  /** A person stops an agent. Nothing wakes it until it is released. */
  halt(agentId: string, actor: string, reason: string): Heartbeat {
    if (!actor.trim() || !reason.trim())
      throw Error("Name who is halting the agent and why");
    this.heartbeat(agentId);
    this.db
      .prepare("UPDATE agent_heartbeats SET halted_reason=? WHERE agent_id=?")
      .run(`${actor}: ${reason}`, agentId);
    return this.heartbeat(agentId);
  }

  /** A person lets a halted agent run again from now. */
  release(agentId: string): Heartbeat {
    const heartbeat = this.heartbeat(agentId);
    this.db
      .prepare(
        "UPDATE agent_heartbeats SET halted_reason=NULL,next_at=? WHERE agent_id=?",
      )
      .run(this.after(heartbeat.cadenceMinutes), agentId);
    return this.heartbeat(agentId);
  }

  /** An agent's wakes, newest first. */
  wakes(agentId: string, limit = 50): Wake[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM agent_wakes WHERE agent_id=? ORDER BY at DESC,rowid DESC LIMIT ?",
      )
      .all(agentId, limit) as WakeRow[];
    return rows.map(toWake);
  }

  /** Why it last woke, what it decided, what it waits on, when it acts next. */
  state(agentId: string): {
    heartbeat: Heartbeat;
    last: Wake | null;
    waitingOn: string | null;
    nextAt: string | null;
  } {
    const heartbeat = this.heartbeat(agentId);
    const last = this.wakes(agentId, 1)[0] ?? null;
    return {
      heartbeat,
      last,
      waitingOn: heartbeat.haltedReason
        ? "a person"
        : (last?.waitingOn ?? null),
      nextAt: heartbeat.haltedReason ? null : heartbeat.nextAt,
    };
  }

  /** Every wake that traces back to one objective, oldest first. */
  trace(objectiveRef: string): Wake[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM agent_wakes WHERE objective_ref=? ORDER BY at,rowid",
      )
      .all(objectiveRef) as WakeRow[];
    return rows.map(toWake);
  }

  private stopCondition(
    heartbeat: Heartbeat,
    trigger: WakeTrigger,
  ): { decision: "refused"; detail: string; waitingOn: string } | null {
    const agent = this.org.agent(heartbeat.agentId);
    const human = trigger === "human_request";
    if (agent.status === "retired")
      return { decision: "refused", detail: "Retired", waitingOn: "nothing" };
    if (heartbeat.haltedReason && !human)
      return {
        decision: "refused",
        detail: "Halted by " + heartbeat.haltedReason,
        waitingOn: "a person",
      };
    if (agent.status === "paused" && !human)
      return { decision: "refused", detail: "Paused", waitingOn: "a person" };
    const since = new Date(this.now().getTime() - 3_600_000).toISOString();
    const recent = this.db
      .prepare(
        "SELECT count(*) AS n FROM agent_wakes WHERE agent_id=? AND at>?",
      )
      .get(heartbeat.agentId, since) as { n: number };
    if (recent.n >= heartbeat.maxWakesPerHour && !human)
      return {
        decision: "refused",
        detail: `Woken ${recent.n} times in the last hour; limit is ${heartbeat.maxWakesPerHour}`,
        waitingOn: "the hourly limit",
      };
    return null;
  }

  private consecutiveActs(agentId: string): number {
    const decisions = this.db
      .prepare(
        "SELECT decision FROM agent_wakes WHERE agent_id=? ORDER BY at DESC,rowid DESC LIMIT 200",
      )
      .all(agentId) as { decision: WakeDecision }[];
    const stop = decisions.findIndex((row) => row.decision !== "act");
    return stop === -1 ? decisions.length : stop;
  }

  private record(
    agentId: string,
    trigger: WakeTrigger,
    reason: string,
    context: { objectiveRef?: string; parentWakeId?: string },
    outcome: {
      decision: WakeDecision;
      detail: string;
      waitingOn?: string;
      counterpartId?: string;
    },
  ): Wake {
    const heartbeat = this.heartbeat(agentId);
    const inherited =
      context.objectiveRef ??
      (context.parentWakeId
        ? (
            this.db
              .prepare("SELECT objective_ref FROM agent_wakes WHERE id=?")
              .get(context.parentWakeId) as
              { objective_ref: string | null } | undefined
          )?.objective_ref
        : null) ??
      null;
    const nextAt = heartbeat.haltedReason
      ? null
      : this.after(heartbeat.cadenceMinutes);
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO agent_wakes(id,agent_id,at,trigger_kind,reason,decision,detail,waiting_on,next_at,objective_ref,counterpart_id,parent_wake_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        agentId,
        this.now().toISOString(),
        trigger,
        reason.slice(0, 1024),
        outcome.decision,
        outcome.detail.slice(0, 2048),
        outcome.waitingOn ?? null,
        nextAt,
        inherited,
        outcome.counterpartId ?? null,
        context.parentWakeId ?? null,
      );
    if (nextAt) this.setNext(agentId, nextAt);
    return toWake(
      this.db
        .prepare("SELECT * FROM agent_wakes WHERE id=?")
        .get(id) as WakeRow,
    );
  }

  private hasHeartbeat(agentId: string): boolean {
    return (
      this.db
        .prepare("SELECT 1 FROM agent_heartbeats WHERE agent_id=?")
        .get(agentId) !== undefined
    );
  }

  private setNext(agentId: string, at: string): void {
    this.db
      .prepare("UPDATE agent_heartbeats SET next_at=? WHERE agent_id=?")
      .run(at, agentId);
  }

  private after(minutes: number): string {
    return new Date(this.now().getTime() + minutes * 60_000).toISOString();
  }
}
