import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { ActionStore } from "./outbox.ts";
import { bindAction } from "../../domain/src/governance.ts";
const digest = (source: string) =>
  createHash("sha256").update(source).digest("hex");
export class SkillLibrary {
  constructor(private db: Database.Database) {}
  installed(product: string) {
    return this.db
      .prepare(
        "SELECT s.name,s.content_hash AS digest,s.source_url AS origin FROM skills s JOIN installed_skill_text t ON t.skill_id=s.id WHERE t.product_id=? ORDER BY s.name",
      )
      .all(product) as { name: string; digest: string; origin: string }[];
  }
  reviews(product: string) {
    return this.db
      .prepare(
        "SELECT id,json_extract(payload_json,'$.name') AS name,json_extract(payload_json,'$.source') AS source,json_extract(payload_json,'$.origin') AS origin,json_extract(payload_json,'$.digest') AS digest FROM actions WHERE product_id=? AND kind='skill_install' AND state='pending_approval' AND json_type(payload_json,'$.source')='text' ORDER BY rowid DESC LIMIT 20",
      )
      .all(product);
  }
  review(product: string, name: string, origin: string, source: string) {
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(name) ||
      !source.trim() ||
      source.length > 12000 ||
      source.includes("\0") ||
      !origin.trim() ||
      origin.length > 512
    )
      throw Error("Invalid skill");
    const id = randomUUID(),
      hash = digest(source),
      previous =
        this.installed(product).find((s) => s.name === name)?.digest ?? null;
    new ActionStore(this.db).propose({
      id,
      productId: product,
      kind: "skill_install",
      requestedBy: "pm",
      operationMarker: id,
      payload: { name, origin, source, digest: hash },
      revisions: { previous },
    });
    return { id, digest: hash };
  }
  decide(product: string, id: string, hash: string, approve: boolean) {
    this.db
      .transaction(() => {
        const store = new ActionStore(this.db);
        if (
          !this.db
            .prepare(
              "SELECT id FROM actions WHERE id=? AND product_id=? AND kind='skill_install' AND state='pending_approval'",
            )
            .get(id, product)
        )
          throw Error("Review expired");
        const action = store.read(id),
          p = action.payload as {
            name: string;
            origin: string;
            source: string;
            digest: string;
          };
        if (p.digest !== hash || digest(p.source) !== hash)
          throw Error("Source changed");
        if (!approve) {
          this.db
            .prepare("UPDATE actions SET state='rejected' WHERE id=?")
            .run(id);
          this.db
            .prepare(
              "INSERT INTO approvals(id,action_id,decision,kind,payload_hash,target_revisions_json,approved_by,approved_at) VALUES(?,?,'reject','skill_install',?,?,'pm',?)",
            )
            .run(
              randomUUID(),
              id,
              bindAction(action.kind, p, action.revisions),
              JSON.stringify(action.revisions),
              new Date().toISOString(),
            );
          return;
        }
        const current =
          this.installed(product).find((s) => s.name === p.name)?.digest ??
          null;
        if (
          current !== (action.revisions as { previous: string | null }).previous
        )
          throw Error("Installed skill changed");
        store.approve(id, "pm");
        if (!store.claim("skill_install", id)) throw Error("Approval changed");
        const key = JSON.stringify([product, p.name]);
        this.db
          .prepare(
            "INSERT INTO skills(id,name,source_url,version,content_hash,approved_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_url=excluded.source_url,version=excluded.version,content_hash=excluded.content_hash,approved_at=excluded.approved_at",
          )
          .run(
            key,
            p.name,
            p.origin,
            hash.slice(0, 12),
            hash,
            new Date().toISOString(),
          );
        this.db
          .prepare(
            "INSERT INTO installed_skill_text(skill_id,product_id,source) VALUES(?,?,?) ON CONFLICT(skill_id) DO UPDATE SET source=excluded.source",
          )
          .run(key, product, p.source);
        store.finish(id, "succeeded");
      })
      .immediate();
  }
  use(product: string, name: string, hash: string) {
    const row = this.db
      .prepare(
        "SELECT t.source FROM installed_skill_text t JOIN skills s ON s.id=t.skill_id WHERE t.product_id=? AND s.name=? AND s.content_hash=? AND s.approved_at IS NOT NULL",
      )
      .get(product, name, hash) as { source: string } | undefined;
    if (!row || digest(row.source) !== hash)
      throw Error("Approved skill unavailable");
    return row.source;
  }
}
