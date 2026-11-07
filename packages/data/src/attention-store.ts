import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  attentionItem,
  type AttentionItem,
} from "../../contracts/src/entities.ts";
import {
  resolveAttention,
  snoozeAttention,
} from "../../domain/src/attention.ts";
interface Row {
  id: string;
  product_id: string;
  type: string;
  origin_kind: string;
  origin_label: string;
  firstmate_ref: string | null;
  ask: string;
  detail: string;
  blocking_refs: string;
  primary_action_json: string;
  governed: number;
  state: string;
  snoozed_until: string | null;
  created_at: string;
}
function decode(row: Row): AttentionItem {
  return attentionItem.parse({
    id: row.id,
    productId: row.product_id,
    type: row.type,
    origin: {
      kind: row.origin_kind,
      label: row.origin_label,
      firstmateRef: row.firstmate_ref,
    },
    ask: row.ask,
    detail: row.detail,
    blocking: JSON.parse(row.blocking_refs),
    primaryAction: JSON.parse(row.primary_action_json),
    governed: row.governed === 1,
    state: row.state,
    snoozedUntil: row.snoozed_until,
    createdAt: row.created_at,
  });
}
export class AttentionStore {
  private readonly db: Database.Database;
  constructor(db: Database.Database) {
    this.db = db;
  }
  create(input: AttentionItem): void {
    const item = attentionItem.parse(input);
    this.db
      .prepare(
        "INSERT INTO attention_items(id,product_id,type,origin_kind,origin_label,firstmate_ref,ask,detail,blocking_refs,primary_action_json,governed,state,snoozed_until,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        item.id,
        item.productId,
        item.type,
        item.origin.kind,
        item.origin.label,
        item.origin.firstmateRef,
        item.ask,
        item.detail,
        JSON.stringify(item.blocking),
        JSON.stringify(item.primaryAction),
        Number(item.governed),
        item.state,
        item.snoozedUntil,
        item.createdAt,
      );
  }
  list(productId: string | null): AttentionItem[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM attention_items WHERE (? IS NULL OR product_id=?) ORDER BY created_at,id",
        )
        .all(productId, productId) as Row[]
    ).map(decode);
  }
  read(id: string): AttentionItem {
    const row = this.db
      .prepare("SELECT * FROM attention_items WHERE id=?")
      .get(id) as Row | undefined;
    if (!row) throw Error("Request not found");
    return decode(row);
  }
  wake(now: number): void {
    if (!Number.isFinite(now)) throw Error("Invalid wake time");
    this.db
      .prepare(
        "UPDATE attention_items SET state='open',snoozed_until=NULL WHERE state='snoozed' AND snoozed_until<=?",
      )
      .run(new Date(now).toISOString());
  }
  snooze(id: string, until: number): void {
    this.db
      .transaction(() => {
        const item = snoozeAttention(this.read(id), until, Date.now());
        this.db
          .prepare(
            "UPDATE attention_items SET state=?,snoozed_until=? WHERE id=?",
          )
          .run(item.state, item.snoozedUntil, id);
      })
      .immediate();
  }
  resolve(id: string, source: "island" | "review", answer?: string): void {
    this.db
      .transaction(() => {
        const item = this.read(id);
        resolveAttention(item, source, answer);
        if (item.type === "answer" && answer)
          this.db
            .prepare(
              "INSERT INTO decisions(id,product_id,question,chosen,rationale,sources_json,decided_by,decided_at) VALUES (?,?,?,?,?,?,?,?)",
            )
            .run(
              randomUUID(),
              item.productId,
              item.ask,
              answer,
              "Answer recorded from request",
              JSON.stringify([item.id]),
              "pm",
              new Date().toISOString(),
            );
        this.db
          .prepare(
            "UPDATE attention_items SET state='resolved',snoozed_until=NULL,resolved_by='pm',resolved_at=? WHERE id=?",
          )
          .run(new Date().toISOString(), id);
      })
      .immediate();
  }
}
export function searchEntities(
  db: Database.Database,
  productId: string | null,
  query: string,
): { id: string; kind: string; title: string }[] {
  if (query.length > 512) throw Error("Search query too long");
  const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 16);
  if (!terms.length) return [];
  const expression = terms
    .map((term) => '"' + term.replaceAll('"', '""') + '"*')
    .join(" AND ");
  return db
    .prepare(
      "SELECT entity_id AS id,kind,title FROM search_index WHERE search_index MATCH ? AND (? IS NULL OR product_id=?) ORDER BY rank LIMIT 50",
    )
    .all(expression, productId, productId) as {
    id: string;
    kind: string;
    title: string;
  }[];
}
