import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { ActionStore, dispatchOne } from "./outbox.ts";
import { bindAction } from "../../domain/src/governance.ts";

export interface AdoDestination {
  collection: string;
  project: string;
  team: string;
}
export interface AdoStep {
  itemId: string;
  type: string;
  parentId: string | null;
  fields: Record<string, string | number | boolean>;
  marker: string;
  revision: number;
  remoteId: number | null;
}
export interface AdoReceipt {
  id: number;
  rev: number;
}
export interface AdoWrites {
  write(step: AdoStep, parentRemoteId: number | null): Promise<AdoReceipt>;
  find(
    step: AdoStep,
    parentRemoteId: number | null,
  ): Promise<AdoReceipt | undefined>;
}
type Kind = "publish" | "commit";
type Entry = {
  actionId: string;
  itemId: string;
  remoteId: number | null;
  remoteRev: number | null;
  state: string;
};
export class AdoBatch {
  private store: ActionStore;
  constructor(private db: Database.Database) {
    this.store = new ActionStore(db);
  }
  prepare(
    productId: string,
    kind: Kind,
    destination: AdoDestination,
    steps: AdoStep[],
  ) {
    if (
      !steps.length ||
      steps.length > 200 ||
      new Set(steps.map((s) => s.itemId)).size !== steps.length
    )
      throw Error("Invalid work item selection");
    const seen = new Set<string>();
    for (const step of steps) {
      if (
        kind === "publish" &&
        (step.remoteId !== null ||
          step.revision !== 0 ||
          (step.parentId && !seen.has(step.parentId)))
      )
        throw Error("Select the parent before its children.");
      if (kind === "commit" && (!step.remoteId || step.revision <= 0))
        throw Error("Select published items with current revisions.");
      seen.add(step.itemId);
    }
    const id = randomUUID(),
      binding = bindAction(kind, { productId, destination, steps }, {});
    this.db
      .transaction(() => {
        this.db
          .prepare("INSERT INTO ado_batches VALUES(?,?,?,?,?,?)")
          .run(
            id,
            productId,
            kind,
            JSON.stringify(destination),
            binding,
            new Date().toISOString(),
          );
        for (const [ordinal, step] of steps.entries()) {
          const actionId = randomUUID();
          this.store.propose({
            id: actionId,
            productId,
            kind,
            payload: { destination, step },
            revisions: { revision: step.revision, batch: binding },
            requestedBy: "pm",
            operationMarker: step.marker,
          });
          this.db
            .prepare(
              "INSERT INTO ado_steps(batch_id,ordinal,item_id,action_id) VALUES(?,?,?,?)",
            )
            .run(id, ordinal, step.itemId, actionId);
        }
      })
      .immediate();
    return this.preview(id);
  }
  preview(id: string) {
    const row = this.db
      .prepare(
        "SELECT product_id AS productId,kind,destination_json,binding FROM ado_batches WHERE id=?",
      )
      .get(id) as
      | {
          productId: string;
          kind: Kind;
          destination_json: string;
          binding: string;
        }
      | undefined;
    if (!row) throw Error("Unknown Azure review");
    const destination = JSON.parse(row.destination_json) as AdoDestination;
    const entries = this.db
      .prepare(
        "SELECT s.action_id AS actionId,s.item_id AS itemId,s.remote_id AS remoteId,s.remote_rev AS remoteRev,a.state FROM ado_steps s JOIN actions a ON a.id=s.action_id WHERE s.batch_id=? ORDER BY ordinal",
      )
      .all(id) as Entry[];
    const steps = entries.map(
      (e) => (this.store.read(e.actionId).payload as { step: AdoStep }).step,
    );
    const binding = bindAction(
      row.kind,
      { productId: row.productId, destination, steps },
      {},
    );
    if (binding !== row.binding) throw Error("Azure review changed.");
    return {
      id,
      binding,
      productId: row.productId,
      kind: row.kind,
      destination,
      steps,
      entries,
    };
  }
  approve(id: string, binding: string) {
    this.db
      .transaction(() => {
        const p = this.preview(id);
        if (p.binding !== binding) throw Error("Preview changed");
        for (const e of p.entries) {
          const active = this.db
            .prepare(
              `SELECT 1 FROM ado_steps s JOIN ado_batches b ON b.id=s.batch_id JOIN actions a ON a.id=s.action_id WHERE s.item_id=? AND b.product_id=? AND b.kind=? AND b.id<>? AND (a.state IN ('approved','executing','unknown') OR (?='publish' AND a.state='succeeded')) LIMIT 1`,
            )
            .get(e.itemId, p.productId, p.kind, id, p.kind);
          if (active)
            throw Error("This item already has an approved operation.");
          this.store.approve(e.actionId, "pm");
        }
      })
      .immediate();
  }
  async execute(id: string, binding: string, api: AdoWrites) {
    const p = this.preview(id);
    if (
      p.binding !== binding ||
      p.entries.some((x) => x.state === "pending_approval")
    )
      throw Error("Exact preview approval required.");
    const receipts = new Map<string, number>();
    for (const [index, e] of p.entries.entries()) {
      const step = p.steps[index]!;
      const parent = step.parentId ? receipts.get(step.parentId) : null;
      if (parent === undefined) break;
      const save = (r: AdoReceipt) => {
        if (
          !Number.isSafeInteger(r.id) ||
          r.id <= 0 ||
          !Number.isSafeInteger(r.rev) ||
          r.rev <= 0
        )
          throw Error("Invalid Azure receipt");
        this.db
          .transaction(() => {
            this.db
              .prepare(
                "UPDATE ado_steps SET remote_id=?,remote_rev=? WHERE action_id=?",
              )
              .run(r.id, r.rev, e.actionId);
            this.db
              .prepare(
                "UPDATE work_items SET remote_system='ado',remote_id=?,remote_rev=?,status=? WHERE product_id=? AND id=?",
              )
              .run(
                String(r.id),
                r.rev,
                p.kind === "publish" ? "published" : "committed",
                p.productId,
                step.itemId,
              );
          })
          .immediate();
      };
      await dispatchOne(
        this.store,
        {
          kind: p.kind,
          execute: async () => save(await api.write(step, parent)),
          reconcile: async () => {
            const found = await api.find(step, parent);
            if (!found) return { state: "unknown" };
            save(found);
            return { state: "found" };
          },
        },
        e.actionId,
      );
      const row = this.db
        .prepare("SELECT remote_id AS id FROM ado_steps WHERE action_id=?")
        .get(e.actionId) as { id: number | null };
      if (this.store.read(e.actionId).state !== "succeeded" || !row.id) break;
      receipts.set(step.itemId, row.id);
    }
    return this.preview(id).entries;
  }
}
