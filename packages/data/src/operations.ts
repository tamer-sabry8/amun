import type Database from "better-sqlite3";
import type {
  AttentionEntry,
  OpsSession,
  OpsSessionState,
  UsageRecord,
} from "../../domain/src/operations.ts";
import { Trajectory } from "./trajectory.ts";

/**
 * Reads the records the dashboard summarises from what Amun already stores:
 * session trajectories, task claims, heartbeats, session goals and agent
 * spend. It only reads.
 */
export class OperationsData {
  private readonly db: Database.Database;
  constructor(db: Database.Database) {
    this.db = db;
  }

  /** One row per recorded session, with its state derived from its history. */
  sessions(productId?: string): OpsSession[] {
    const trajectory = new Trajectory(this.db);
    const states: Record<string, OpsSessionState> = {
      empty: "queued",
      in_progress: "active",
      awaiting_approval: "waiting",
      failed: "failed",
      completed: "completed",
    };
    return trajectory.sessions(productId).map((session) => {
      const events = trajectory.events(session.id);
      const brief = trajectory.resume(session.id);
      const own = events.filter((event) => event.sessionId === session.id);
      const last = own.at(-1) ?? events.at(-1);
      return {
        id: session.id,
        title: session.title,
        owner: last?.participant ?? session.origin,
        state: states[brief.state] ?? "active",
        stage: last ? last.source : "not started",
        startedAt: session.createdAt,
        lastActivityAt: last?.at ?? session.createdAt,
        nextAction:
          brief.approvalsNeeded[0]?.summary ??
          brief.openErrors[0]?.summary ??
          brief.incomplete[0]?.summary ??
          null,
      };
    });
  }

  /** Items that need a person, gathered from every source that can raise one. */
  attention(now: Date): AttentionEntry[] {
    const at = now.toISOString();
    const entries: AttentionEntry[] = [];
    for (const session of this.sessions()) {
      if (session.state === "waiting")
        entries.push({
          id: "approval:" + session.id,
          kind: "approval",
          title: session.nextAction ?? session.title,
          sessionId: session.id,
          severity: 2,
          customerImpact: false,
          businessImpact: 1,
          raisedAt: session.lastActivityAt,
        });
      if (session.state === "failed")
        entries.push({
          id: "failure:" + session.id,
          kind: "failure",
          title: session.nextAction ?? session.title,
          sessionId: session.id,
          severity: 2,
          customerImpact: false,
          businessImpact: 1,
          raisedAt: session.lastActivityAt,
        });
    }
    for (const row of this.db
      .prepare(
        "SELECT task_kind,task_id,holder_id,expires_at FROM task_claims WHERE state='claimed' AND expires_at IS NOT NULL AND expires_at<=?",
      )
      .all(at) as {
      task_kind: string;
      task_id: string;
      holder_id: string;
      expires_at: string;
    }[])
      entries.push({
        id: `stuck:${row.task_kind}:${row.task_id}`,
        kind: "stuck",
        title: `${row.task_id} has had no update from ${row.holder_id}`,
        sessionId: null,
        severity: 2,
        customerImpact: false,
        businessImpact: 1,
        raisedAt: row.expires_at,
      });
    for (const row of this.db
      .prepare(
        `SELECT w.id,w.at,w.detail,a.display_name FROM agent_wakes w JOIN agents a ON a.id=w.agent_id
         WHERE w.decision='escalate' AND NOT EXISTS (SELECT 1 FROM agent_wakes later WHERE later.parent_wake_id=w.id)`,
      )
      .all() as {
      id: string;
      at: string;
      detail: string;
      display_name: string;
    }[])
      entries.push({
        id: "escalation:" + row.id,
        kind: "escalation",
        title: `${row.display_name}: ${row.detail}`,
        sessionId: null,
        severity: 2,
        customerImpact: false,
        businessImpact: 2,
        raisedAt: row.at,
      });
    for (const row of this.db
      .prepare(
        "SELECT h.agent_id,h.halted_reason,a.display_name FROM agent_heartbeats h JOIN agents a ON a.id=h.agent_id WHERE h.halted_reason IS NOT NULL",
      )
      .all() as {
      agent_id: string;
      halted_reason: string;
      display_name: string;
    }[])
      entries.push({
        id: "halted:" + row.agent_id,
        kind: "policy_violation",
        title: `${row.display_name} is halted: ${row.halted_reason}`,
        sessionId: null,
        severity: 3,
        customerImpact: false,
        businessImpact: 1,
        raisedAt: at,
      });
    for (const row of this.db
      .prepare(
        "SELECT id,session_ref,title,blocked_reason,updated_at FROM session_goals WHERE state='blocked'",
      )
      .all() as {
      id: string;
      session_ref: string;
      title: string;
      blocked_reason: string;
      updated_at: string;
    }[])
      entries.push({
        id: "goal:" + row.id,
        kind: row.blocked_reason === "budget" ? "budget_warning" : "escalation",
        title: `${row.title} is blocked (${row.blocked_reason.replace("_", " ")})`,
        sessionId: row.session_ref,
        severity: 2,
        customerImpact: false,
        businessImpact: 2,
        raisedAt: row.updated_at,
      });
    return entries;
  }

  /** Recorded spend per agent. Token counts are not stored yet and read as 0. */
  usage(window: { from?: string; to?: string } = {}): UsageRecord[] {
    return (
      this.db
        .prepare(
          `SELECT u.at,u.micros,a.display_name,a.runtime FROM agent_usage u JOIN agents a ON a.id=u.agent_id
           WHERE u.at>=? AND u.at<=? ORDER BY u.at,u.rowid`,
        )
        .all(window.from ?? "", window.to ?? "9999") as {
        at: string;
        micros: number;
        display_name: string;
        runtime: string;
      }[]
    ).map((row) => ({
      at: row.at,
      agent: row.display_name,
      model: row.runtime,
      tokens: 0,
      costMicros: row.micros,
      durationMs: 0,
    }));
  }
}
