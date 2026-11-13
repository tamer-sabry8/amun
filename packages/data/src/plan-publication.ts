// Publishes an approved plan (work_plans) to its destinations and reports
// each item back through the store's own "record-results" command.
//
// One approval covers exactly the approved items. Each item gets one stable
// marker, so a write whose outcome is uncertain is looked up before anything
// is sent again: found → linked, confirmed missing → retried once under the
// same approval, still uncertain → reported as "unknown" for the owner.
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export interface PlanWriteItem {
  id: string;
  summary: string;
  fields: Record<string, string | number | null>;
  /** Stable per item for the life of the plan; written with the item. */
  marker: string;
  destination: string;
}
export interface PlanReceipt {
  externalId: string;
  url?: string | undefined;
}
export interface PlanTarget {
  /** Creates the item. Throws when the outcome is a failure or uncertain. */
  write(item: PlanWriteItem): Promise<PlanReceipt>;
  /**
   * Looks the item up by its marker. `undefined` means the destination
   * confirmed it is absent; a throw means that could not be established.
   */
  find(item: PlanWriteItem): Promise<PlanReceipt | undefined>;
}
export interface PlanScope {
  planId: string;
  groupId: string | null;
  workAreaId: string | null;
}
/** Throws `PlanBlocked` with a plain reason when nothing can be sent. */
export type ResolveTarget = (
  destination: string,
  scope: PlanScope,
) => Promise<PlanTarget>;
/** The destination cannot be written to at all; nothing was sent. */
export class PlanBlocked extends Error {}
/** Thrown by `write` when the request provably never left the Mac. */
export class PlanNotSent extends Error {}

type WriteState = "pending" | "sent" | "created" | "missing" | "unknown";
interface WriteRow {
  item_id: string;
  marker: string;
  destination: string;
  state: WriteState;
  external_id: string | null;
  url: string | null;
  attempts: number;
  note: string | null;
}
interface Records {
  handle(input: unknown): unknown[];
}
type Result = {
  id: string;
  state: "created" | "failed" | "unknown";
  externalId?: string;
  url?: string;
};
/** One first attempt and one retry of an item confirmed missing. */
export const planWriteBudget = 2;

export class PlanPublisher {
  private readonly running = new Map<string, Promise<unknown[]>>();
  constructor(
    private readonly db: Database.Database,
    private readonly records: Records,
    private readonly resolve: ResolveTarget,
  ) {}

  /** Plans with a write that was sent and never confirmed (e.g. after a crash). */
  uncertain(): string[] {
    return (
      this.db
        .prepare(
          "SELECT DISTINCT w.plan_id AS id FROM plan_writes w JOIN work_plans p ON p.id=w.plan_id WHERE w.state IN ('sent','unknown') AND p.state IN ('approved','partial','failed')",
        )
        .all() as { id: string }[]
    ).map((row) => row.id);
  }

  /** What was written for a plan, for display and audit. */
  writes(planId: string) {
    return (
      this.db
        .prepare("SELECT * FROM plan_writes WHERE plan_id=? ORDER BY rowid")
        .all(planId) as WriteRow[]
    ).map((row) => ({
      id: row.item_id,
      destination: row.destination,
      state: row.state,
      externalId: row.external_id,
      url: row.url,
      attempts: row.attempts,
      note: row.note,
    }));
  }

  /**
   * Publishes or continues publishing one approved plan. With
   * `reconcileOnly`, nothing new is sent: uncertain writes are looked up and
   * linked if found.
   */
  publish(planId: string, options: { reconcileOnly?: boolean } = {}) {
    const active = this.running.get(planId);
    if (active) return active;
    const run = this.run(planId, options.reconcileOnly === true).finally(() =>
      this.running.delete(planId),
    );
    this.running.set(planId, run);
    return run;
  }

  private rows(planId: string) {
    return this.db
      .prepare("SELECT * FROM plan_writes WHERE plan_id=? ORDER BY rowid")
      .all(planId) as WriteRow[];
  }
  private set(
    planId: string,
    itemId: string,
    patch: Partial<Omit<WriteRow, "item_id" | "marker" | "destination">>,
  ) {
    const row = this.db
      .prepare("SELECT * FROM plan_writes WHERE plan_id=? AND item_id=?")
      .get(planId, itemId) as WriteRow;
    const next = { ...row, ...patch };
    this.db
      .prepare(
        "UPDATE plan_writes SET state=?,external_id=?,url=?,attempts=?,note=? WHERE plan_id=? AND item_id=?",
      )
      .run(
        next.state,
        next.external_id,
        next.url,
        next.attempts,
        next.note,
        planId,
        itemId,
      );
  }

  private async run(planId: string, reconcileOnly: boolean) {
    const plan = this.db
      .prepare(
        "SELECT group_id,work_area_id,destination,approved_json,state FROM work_plans WHERE id=?",
      )
      .get(planId) as
      | {
          group_id: string | null;
          work_area_id: string | null;
          destination: string;
          approved_json: string | null;
          state: string;
        }
      | undefined;
    if (
      !plan?.approved_json ||
      !["approved", "partial", "failed"].includes(plan.state)
    )
      return [];
    const items = JSON.parse(plan.approved_json) as Omit<
      PlanWriteItem,
      "marker" | "destination"
    >[];
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO plan_writes(plan_id,item_id,marker,destination,state,attempts) VALUES (?,?,?,?,'pending',0)",
    );
    this.db
      .transaction(() => {
        for (const item of items) {
          const own = item.fields.destination;
          insert.run(
            planId,
            item.id,
            randomUUID(),
            typeof own === "string" && own.trim()
              ? own.trim().toLowerCase()
              : plan.destination,
          );
        }
      })
      .immediate();
    const scope: PlanScope = {
      planId,
      groupId: plan.group_id,
      workAreaId: plan.work_area_id,
    };
    const targets = new Map<string, Promise<PlanTarget>>();
    const target = (destination: string) => {
      let found = targets.get(destination);
      if (!found) {
        found = this.resolve(destination, scope);
        // A rejected lookup is reported per item below, not as unhandled.
        found.catch(() => undefined);
        targets.set(destination, found);
      }
      return found;
    };
    const results: Result[] = [];
    const done = (row: WriteRow, receipt: PlanReceipt) => {
      this.set(planId, row.item_id, {
        state: "created",
        external_id: receipt.externalId,
        url: receipt.url ?? null,
        note: null,
      });
      results.push({
        id: row.item_id,
        state: "created",
        externalId: receipt.externalId,
        ...(receipt.url ? { url: receipt.url } : {}),
      });
    };
    for (const row of this.rows(planId)) {
      const source = items.find((item) => item.id === row.item_id);
      if (!source || row.state === "created") continue;
      // Reconciling never starts a write that was not already sent.
      if (reconcileOnly && row.state === "pending") continue;
      const item: PlanWriteItem = {
        ...source,
        marker: row.marker,
        destination: row.destination,
      };
      let api: PlanTarget;
      try {
        api = await target(row.destination);
      } catch (error) {
        // Nothing can be sent or looked up. A write already sent stays
        // uncertain; one never sent is simply not created.
        const sent = row.state === "sent" || row.state === "unknown";
        this.set(planId, row.item_id, {
          state: sent ? "unknown" : row.state,
          note:
            error instanceof PlanBlocked
              ? error.message
              : "The destination is unavailable.",
        });
        results.push({ id: row.item_id, state: sent ? "unknown" : "failed" });
        continue;
      }
      let state: WriteState = row.state;
      let attempts = row.attempts;
      let settled = false;
      while (!settled) {
        if (state === "sent" || state === "unknown") {
          // Look before sending anything again.
          let found: PlanReceipt | undefined;
          try {
            found = await api.find(item);
          } catch {
            this.set(planId, row.item_id, {
              state: "unknown",
              note: "Could not confirm whether this was created.",
            });
            results.push({ id: row.item_id, state: "unknown" });
            break;
          }
          if (found) {
            done(row, found);
            break;
          }
          state = "missing";
          this.set(planId, row.item_id, { state, note: null });
        }
        if (reconcileOnly || attempts >= planWriteBudget) {
          results.push({ id: row.item_id, state: "failed" });
          settled = true;
          break;
        }
        attempts += 1;
        state = "sent";
        // Recorded before the request leaves, so a crash is seen as uncertain.
        this.set(planId, row.item_id, { state, attempts });
        try {
          done(row, await api.write(item));
          settled = true;
        } catch (error) {
          this.set(planId, row.item_id, {
            note: error instanceof Error ? error.message.slice(0, 300) : null,
          });
          if (error instanceof PlanNotSent) {
            // Nothing left the Mac, so there is nothing to look up.
            state = "missing";
            this.set(planId, row.item_id, { state });
          }
          // Otherwise the outcome is uncertain: loop back and look it up.
        }
      }
    }
    if (!results.length) return [];
    return this.records.handle({
      version: 1,
      kind: "work",
      action: "record-results",
      planId,
      results,
    });
  }
}
