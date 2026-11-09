import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

export function dependencies(db: Database.Database) {
  const rows = db
    .prepare(
      `
    SELECT DISTINCT a.product_id AS leftId,b.product_id AS rightId,p.name AS left,q.name AS right,a.external_id AS reference
    FROM sources a JOIN sources b ON a.product_id<b.product_id AND a.external_id=b.external_id
    JOIN products p ON p.id=a.product_id JOIN products q ON q.id=b.product_id
    WHERE a.kind='repo' AND b.kind='repo' AND trim(a.external_id)<>''
    ORDER BY leftId,rightId,reference`,
    )
    .all() as {
    leftId: string;
    rightId: string;
    left: string;
    right: string;
    reference: string;
  }[];
  const confirmed = new Set(
    db
      .prepare("SELECT evidence_key FROM portfolio_confirmations")
      .pluck()
      .all(),
  );
  return rows.map(({ leftId, rightId, left, right, reference }) => {
    const key = createHash("sha256")
      .update(JSON.stringify([leftId, rightId, reference]))
      .digest("hex");
    return { key, left, right, reference, confirmed: confirmed.has(key) };
  });
}

export function portfolio(db: Database.Database) {
  const products = db
    .prepare("SELECT id,name FROM products ORDER BY created_at,id")
    .all() as { id: string; name: string }[];
  const progress = db.prepare(
    "SELECT status,count(*) AS count FROM work_items WHERE product_id=? GROUP BY status ORDER BY status",
  );
  const blockers = db
    .prepare(
      `SELECT ask FROM attention_items WHERE product_id=? AND state<>'resolved' AND json_array_length(blocking_refs)>0
    UNION SELECT title FROM work_items WHERE product_id=? AND lower(status)='blocked' ORDER BY 1`,
    )
    .pluck();
  const decisions = db
    .prepare(
      "SELECT ask FROM attention_items WHERE product_id=? AND type='decide' AND state<>'resolved' ORDER BY created_at,id",
    )
    .pluck();
  return {
    products: products.map((p) => ({
      ...p,
      progress: progress.all(p.id),
      blockers: blockers.all(p.id, p.id),
      decisions: decisions.all(p.id),
    })),
    dependencies: dependencies(db),
  };
}
