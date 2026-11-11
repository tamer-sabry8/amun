import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export const holderKinds = ["agent", "human", "team", "service"] as const;
export type HolderKind = (typeof holderKinds)[number];

export const taskStates = [
  "available",
  "claimed",
  "waiting_human",
  "waiting_dependency",
  "failed",
  "paused",
  "completed",
] as const;
export type TaskState = (typeof taskStates)[number];

export interface Holder {
  kind: HolderKind;
  id: string;
}

export interface TaskRef {
  kind: string;
  id: string;
}

export interface TaskClaim {
  task: TaskRef;
  state: TaskState;
  holder: Holder | null;
  /** What the holder says it is doing. */
  activity: string;
  /** Increases every time the task changes hands. */
  generation: number;
  acquiredAt: string | null;
  renewedAt: string | null;
  expiresAt: string | null;
  /** Milliseconds the current holder has held the task. */
  heldForMs: number | null;
  /** True when an active claim has outlived its lease without renewal. */
  stalled: boolean;
}

export interface ClaimEvent {
  at: string;
  actor: string;
  event: string;
  holder: string | null;
  reason: string;
}

export type CheckoutRefusal =
  "held_by_another" | "completed" | "paused" | "not_holder";

export type CheckoutResult =
  | { ok: true; claim: TaskClaim }
  | { ok: false; reason: CheckoutRefusal; claim: TaskClaim };

interface Row {
  task_kind: string;
  task_id: string;
  holder_kind: HolderKind | null;
  holder_id: string | null;
  state: TaskState;
  activity: string;
  generation: number;
  acquired_at: string | null;
  renewed_at: string | null;
  expires_at: string | null;
}

const active: readonly TaskState[] = [
  "claimed",
  "waiting_human",
  "waiting_dependency",
];
export const defaultLeaseMs = 15 * 60 * 1000;

function same(left: Holder | null, right: Holder): boolean {
  return left !== null && left.kind === right.kind && left.id === right.id;
}

function name(holder: Holder | null): string | null {
  return holder ? holder.kind + ":" + holder.id : null;
}

/**
 * One task, one holder, one execution at a time. A claim is taken in a single
 * immediate transaction, so two callers cannot both win. A claim that is not
 * renewed becomes stalled and can be recovered, never left locked for good.
 */
export class TaskCheckout {
  private readonly db: Database.Database;
  private readonly now: () => Date;
  constructor(db: Database.Database, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
  }

  status(task: TaskRef): TaskClaim {
    return this.toClaim(this.row(task), task);
  }

  /** Every task that is held or waiting, longest-held first. */
  held(): TaskClaim[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM task_claims WHERE holder_id IS NOT NULL ORDER BY acquired_at,task_kind,task_id",
      )
      .all() as Row[];
    return rows.map((row) =>
      this.toClaim(row, { kind: row.task_kind, id: row.task_id }),
    );
  }

  /**
   * Takes the exclusive claim on a task. It succeeds when the task is
   * available, failed, or already held by the same holder; it is refused
   * while anyone else holds it, even if their claim has stalled — a stalled
   * claim is released through `recover`, so takeover is always deliberate.
   */
  checkout(
    task: TaskRef,
    holder: Holder,
    activity = "",
    leaseMs = defaultLeaseMs,
  ): CheckoutResult {
    this.validate(task, holder, leaseMs);
    return this.db
      .transaction((): CheckoutResult => {
        const current = this.toClaim(this.row(task), task);
        if (current.state === "completed")
          return { ok: false, reason: "completed", claim: current };
        if (current.state === "paused" && !same(current.holder, holder))
          return { ok: false, reason: "paused", claim: current };
        if (current.holder && !same(current.holder, holder))
          return { ok: false, reason: "held_by_another", claim: current };
        const at = this.now();
        const renewing = same(current.holder, holder);
        this.write(task, {
          holder,
          state: "claimed",
          activity: activity.slice(0, 512),
          generation: current.generation + (renewing ? 0 : 1),
          acquiredAt: renewing ? current.acquiredAt : at.toISOString(),
          renewedAt: at.toISOString(),
          expiresAt: new Date(at.getTime() + leaseMs).toISOString(),
        });
        this.log(task, name(holder)!, renewing ? "renewed" : "claimed", holder);
        return { ok: true, claim: this.status(task) };
      })
      .immediate();
  }

  /** Extends the holder's lease and updates what it reports doing. */
  renew(
    task: TaskRef,
    holder: Holder,
    activity?: string,
    leaseMs = defaultLeaseMs,
  ): CheckoutResult {
    return this.db
      .transaction((): CheckoutResult => {
        const current = this.status(task);
        if (!same(current.holder, holder) || !active.includes(current.state))
          return { ok: false, reason: "not_holder", claim: current };
        const at = this.now();
        this.write(task, {
          holder,
          state: current.state,
          activity: (activity ?? current.activity).slice(0, 512),
          generation: current.generation,
          acquiredAt: current.acquiredAt,
          renewedAt: at.toISOString(),
          expiresAt: new Date(at.getTime() + leaseMs).toISOString(),
        });
        return { ok: true, claim: this.status(task) };
      })
      .immediate();
  }

  /** Moves a held task between executing and waiting, keeping the holder. */
  wait(
    task: TaskRef,
    holder: Holder,
    on: "human" | "dependency" | "nothing",
    reason: string,
  ): CheckoutResult {
    return this.transition(
      task,
      holder,
      on === "nothing" ? "claimed" : `waiting_${on}`,
      on === "nothing" ? "resumed" : "waiting_" + on,
      reason,
      true,
    );
  }

  /** The holder finishes the task. Completed work cannot be claimed again. */
  complete(task: TaskRef, holder: Holder, reason = ""): CheckoutResult {
    return this.transition(
      task,
      holder,
      "completed",
      "completed",
      reason,
      false,
    );
  }

  /** The holder reports failure. The task is released for another attempt. */
  fail(task: TaskRef, holder: Holder, reason: string): CheckoutResult {
    return this.transition(task, holder, "failed", "failed", reason, false);
  }

  /** The holder gives the task back unfinished. */
  release(task: TaskRef, holder: Holder, reason = ""): CheckoutResult {
    return this.transition(
      task,
      holder,
      "available",
      "released",
      reason,
      false,
    );
  }

  /**
   * Hands a held task to another holder in one step, so it is never briefly
   * unowned. Done by the current holder or by a named person.
   */
  transfer(
    task: TaskRef,
    to: Holder,
    actor: string,
    reason: string,
    leaseMs = defaultLeaseMs,
  ): TaskClaim {
    this.validate(task, to, leaseMs);
    this.need(actor, reason);
    return this.db
      .transaction(() => {
        const current = this.status(task);
        if (!current.holder) throw Error("Nobody holds this task");
        if (current.state === "completed")
          throw Error("Completed work is not transferred");
        const at = this.now();
        this.write(task, {
          holder: to,
          state: "claimed",
          activity: "",
          generation: current.generation + 1,
          acquiredAt: at.toISOString(),
          renewedAt: at.toISOString(),
          expiresAt: new Date(at.getTime() + leaseMs).toISOString(),
        });
        this.log(task, actor, "transferred", to, reason);
        return this.status(task);
      })
      .immediate();
  }

  /** A person stops a task. It stays with its holder until resumed. */
  pause(task: TaskRef, actor: string, reason: string): TaskClaim {
    return this.override(task, actor, reason, "paused", "paused", true);
  }

  /** A person lets a paused task be worked on again. */
  resume(task: TaskRef, actor: string, reason: string): TaskClaim {
    const current = this.status(task);
    if (current.state !== "paused") throw Error("This task is not paused");
    return this.override(
      task,
      actor,
      reason,
      current.holder ? "claimed" : "available",
      "resumed",
      true,
    );
  }

  /** A person takes a task away from its holder and makes it available. */
  reclaim(task: TaskRef, actor: string, reason: string): TaskClaim {
    return this.override(task, actor, reason, "available", "reclaimed", false);
  }

  /**
   * Controlled recovery: releases every active claim whose lease ran out
   * without renewal. Returns the tasks that became available again.
   */
  recover(actor = "system"): TaskClaim[] {
    return this.db
      .transaction(() => {
        const cutoff = this.now().toISOString();
        const rows = this.db
          .prepare(
            "SELECT * FROM task_claims WHERE state='claimed' AND expires_at IS NOT NULL AND expires_at<=?",
          )
          .all(cutoff) as Row[];
        return rows.map((row) => {
          const task = { kind: row.task_kind, id: row.task_id };
          const previous = this.toClaim(row, task);
          this.write(task, {
            holder: null,
            state: "available",
            activity: "",
            generation: previous.generation + 1,
            acquiredAt: null,
            renewedAt: null,
            expiresAt: null,
          });
          this.log(
            task,
            actor,
            "recovered",
            previous.holder,
            "Lease expired without renewal",
          );
          return this.status(task);
        });
      })
      .immediate();
  }

  /** The audit trail of a task: who held it, when, and why it moved. */
  history(task: TaskRef): ClaimEvent[] {
    return this.db
      .prepare(
        "SELECT at,actor,event,holder,reason FROM task_claim_events WHERE task_kind=? AND task_id=? ORDER BY rowid",
      )
      .all(task.kind, task.id) as ClaimEvent[];
  }

  private transition(
    task: TaskRef,
    holder: Holder,
    state: TaskState,
    event: string,
    reason: string,
    keep: boolean,
  ): CheckoutResult {
    return this.db
      .transaction((): CheckoutResult => {
        const current = this.status(task);
        if (!same(current.holder, holder) || !active.includes(current.state))
          return { ok: false, reason: "not_holder", claim: current };
        const now = this.now();
        const at = now.toISOString();
        this.write(task, {
          holder: keep ? holder : null,
          state,
          activity: keep ? current.activity : "",
          generation: current.generation + (keep ? 0 : 1),
          acquiredAt: keep ? current.acquiredAt : null,
          renewedAt: keep ? at : null,
          // Waiting on a person or a dependency does not expire.
          expiresAt:
            keep && state === "claimed"
              ? new Date(now.getTime() + defaultLeaseMs).toISOString()
              : null,
        });
        this.log(task, name(holder)!, event, holder, reason);
        return { ok: true, claim: this.status(task) };
      })
      .immediate();
  }

  private override(
    task: TaskRef,
    actor: string,
    reason: string,
    state: TaskState,
    event: string,
    keep: boolean,
  ): TaskClaim {
    this.need(actor, reason);
    return this.db
      .transaction(() => {
        const current = this.status(task);
        if (current.state === "completed")
          throw Error("Completed work is not changed");
        const holder = keep ? current.holder : null;
        const at = this.now();
        this.write(task, {
          holder,
          state,
          activity: keep ? current.activity : "",
          generation: current.generation + (keep ? 0 : 1),
          acquiredAt: keep ? current.acquiredAt : null,
          renewedAt: keep && holder ? at.toISOString() : null,
          expiresAt:
            state === "claimed"
              ? new Date(at.getTime() + defaultLeaseMs).toISOString()
              : null,
        });
        this.log(task, actor, event, current.holder, reason);
        return this.status(task);
      })
      .immediate();
  }

  private need(actor: string, reason: string): void {
    if (!actor.trim()) throw Error("Name who is making this change");
    if (!reason.trim()) throw Error("Give a reason for this change");
  }

  private validate(task: TaskRef, holder: Holder, leaseMs: number): void {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(task.kind) || !task.id.trim())
      throw Error("Invalid task");
    if (!holderKinds.includes(holder.kind) || !holder.id.trim())
      throw Error("Invalid holder");
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000)
      throw Error("Invalid lease");
  }

  private row(task: TaskRef): Row | undefined {
    return this.db
      .prepare("SELECT * FROM task_claims WHERE task_kind=? AND task_id=?")
      .get(task.kind, task.id) as Row | undefined;
  }

  private toClaim(row: Row | undefined, task: TaskRef): TaskClaim {
    const now = this.now().getTime();
    const holder =
      row?.holder_kind && row.holder_id
        ? { kind: row.holder_kind, id: row.holder_id }
        : null;
    return {
      task,
      state: row?.state ?? "available",
      holder,
      activity: row?.activity ?? "",
      generation: row?.generation ?? 0,
      acquiredAt: row?.acquired_at ?? null,
      renewedAt: row?.renewed_at ?? null,
      expiresAt: row?.expires_at ?? null,
      heldForMs:
        holder && row?.acquired_at ? now - Date.parse(row.acquired_at) : null,
      stalled:
        row?.state === "claimed" &&
        row.expires_at !== null &&
        Date.parse(row.expires_at) <= now,
    };
  }

  private write(
    task: TaskRef,
    next: {
      holder: Holder | null;
      state: TaskState;
      activity: string;
      generation: number;
      acquiredAt: string | null;
      renewedAt: string | null;
      expiresAt: string | null;
    },
  ): void {
    this.db
      .prepare(
        `INSERT INTO task_claims(task_kind,task_id,holder_kind,holder_id,state,activity,generation,acquired_at,renewed_at,expires_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(task_kind,task_id) DO UPDATE SET holder_kind=excluded.holder_kind,holder_id=excluded.holder_id,state=excluded.state,
           activity=excluded.activity,generation=excluded.generation,acquired_at=excluded.acquired_at,renewed_at=excluded.renewed_at,expires_at=excluded.expires_at`,
      )
      .run(
        task.kind,
        task.id,
        next.holder?.kind ?? null,
        next.holder?.id ?? null,
        next.state,
        next.activity,
        next.generation,
        next.acquiredAt,
        next.renewedAt,
        next.expiresAt,
      );
  }

  private log(
    task: TaskRef,
    actor: string,
    event: string,
    holder: Holder | null,
    reason = "",
  ): void {
    this.db
      .prepare(
        "INSERT INTO task_claim_events(id,task_kind,task_id,at,actor,event,holder,reason) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        task.kind,
        task.id,
        this.now().toISOString(),
        actor,
        event,
        name(holder),
        reason.slice(0, 1024),
      );
  }
}
