import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { ActionStore } from "./outbox.ts";
import { bindAction } from "../../domain/src/governance.ts";
export class StakeholderUpdates {
  constructor(private db: Database.Database) {}
  draft(product: string | null, objective?: string): string {
    if (product === null) {
      if (objective) throw Error("Select a product for an initiative");
      const ids = this.db
        .prepare("SELECT id FROM products ORDER BY name,id")
        .pluck()
        .all() as string[];
      return ids
        .map((id) => this.draft(id))
        .join("\n\n")
        .slice(0, 96000);
    }
    const p = this.db
      .prepare("SELECT name FROM products WHERE id=?")
      .pluck()
      .get(product);
    if (typeof p !== "string") throw Error("Select product");
    const work = this.db
      .prepare(
        `SELECT w.id,w.title,w.status FROM work_items w WHERE w.product_id=? AND (? IS NULL OR EXISTS(SELECT 1 FROM story_drafts d WHERE d.item_id=w.id AND d.objective_id=?)) ORDER BY w.rowid DESC LIMIT 40`,
      )
      .all(product, objective ?? null, objective ?? null) as {
      id: string;
      title: string;
      status: string;
    }[];
    const acceptance = this.db
      .prepare(
        `SELECT a.id,w.title,a.verdict FROM delivery_acceptance a JOIN work_items w ON w.id=a.story_id WHERE w.product_id=? AND (? IS NULL OR EXISTS(SELECT 1 FROM story_drafts d WHERE d.item_id=w.id AND d.objective_id=?)) ORDER BY a.rowid DESC LIMIT 20`,
      )
      .all(product, objective ?? null, objective ?? null) as {
      id: string;
      title: string;
      verdict: string;
    }[];
    return [
      p,
      "Progress",
      ...(work.length
        ? work.map(
            (w) => w.title + " — " + w.status + " [work item: " + w.id + "]",
          )
        : ["Unknown — no work items recorded."]),
      "",
      "Acceptance",
      ...(acceptance.length
        ? acceptance.map(
            (a) => a.title + " — " + a.verdict + " [acceptance: " + a.id + "]",
          )
        : ["Unknown — no acceptance verdict recorded."]),
    ].join("\n");
  }
  prepareExport(product: string | null, title: string, text: string) {
    const id = randomUUID(),
      destination = "exports/" + id + ".pdf",
      payload = { title, text, destination },
      revisions = { product };
    new ActionStore(this.db).propose({
      id,
      kind: "publish",
      productId: product,
      payload,
      revisions,
      requestedBy: "pm",
      operationMarker: id,
    });
    return {
      id,
      binding: bindAction("publish", payload, revisions),
      title,
      text,
      destination,
    };
  }
  claimExport(
    product: string | null,
    id: string,
    binding: string,
    title: string,
    text: string,
  ) {
    const store = new ActionStore(this.db),
      payload = { title, text, destination: "exports/" + id + ".pdf" };
    const expected = bindAction("publish", payload, { product });
    const action = store.read(id);
    if (
      action.kind !== "publish" ||
      action.state !== "pending_approval" ||
      expected !== binding ||
      bindAction(action.kind, action.payload, action.revisions) !== expected
    )
      throw Error("Export review changed");
    this.db
      .transaction(() => {
        store.approve(id, "pm");
        if (!store.claim("publish", id)) throw Error("Missing approval");
      })
      .immediate();
  }
}
