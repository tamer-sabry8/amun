import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  modelRoute,
  routingReview,
  type Route,
} from "../../contracts/src/model-routing.ts";
import { ActionStore } from "./outbox.ts";
import { bindAction } from "../../domain/src/governance.ts";
import { AuthoringError } from "./product-documents.ts";
export class ModelRouting {
  constructor(private db: Database.Database) {}
  record(product: string, id: string, model: string, role: string) {
    this.db
      .prepare(
        "INSERT INTO runs(id,product_id,agent_role,harness,model,state,started_at) VALUES(?,?,?,'pi',?,'completed',?)",
      )
      .run(id, product, role, model, new Date().toISOString());
  }
  recent(product: string) {
    return this.db
      .prepare(
        "SELECT id,agent_role AS task,model FROM runs WHERE product_id=? AND harness='pi' AND state='completed' AND model IS NOT NULL ORDER BY rowid DESC LIMIT 10",
      )
      .all(product) as { id: string; task: string; model: string }[];
  }
  list(product: string) {
    return this.db
      .prepare(
        "SELECT task,difficulty,model FROM model_routes WHERE product_id=? ORDER BY task,difficulty",
      )
      .all(product)
      .map((x) => modelRoute.parse(x));
  }
  private policy(product: string) {
    const r = this.db
      .prepare("SELECT allowed_models_json FROM products WHERE id=?")
      .get(product) as { allowed_models_json: string } | undefined;
    if (!r) throw new AuthoringError("Unknown product.");
    return JSON.parse(r.allowed_models_json) as string[];
  }
  private put(product: string, r: Route) {
    this.db
      .prepare(
        "INSERT INTO model_routes(product_id,task,difficulty,model) VALUES(?,?,?,?) ON CONFLICT(product_id,task,difficulty) DO UPDATE SET model=excluded.model",
      )
      .run(product, r.task, r.difficulty, r.model);
  }
  private revisions(product: string, r: Route) {
    return {
      allowed: this.policy(product),
      previous:
        this.list(product).find(
          (x) => x.task === r.task && x.difficulty === r.difficulty,
        )?.model ?? null,
    };
  }
  pending(product: string) {
    return this.db
      .prepare(
        "SELECT id,payload_hash AS binding,payload_json FROM actions WHERE product_id=? AND kind='model_outside_allowlist' AND state='pending_approval' ORDER BY rowid DESC LIMIT 20",
      )
      .all(product)
      .map((x) => {
        const row = x as { id: string; binding: string; payload_json: string };
        const { task, difficulty, model } = JSON.parse(row.payload_json);
        return routingReview.parse({
          task,
          difficulty,
          model,
          id: row.id,
          binding: row.binding,
        });
      });
  }
  save(input: Route & { productId: string }) {
    const { productId, ...raw } = input,
      route = modelRoute.parse(raw);
    return this.db
      .transaction(() => {
        const revisions = this.revisions(productId, route);
        if (revisions.allowed.includes(route.model)) {
          this.put(productId, route);
          return null;
        }
        const id = randomUUID(),
          payload = { productId, ...route },
          kind = "model_outside_allowlist";
        new ActionStore(this.db).propose({
          id,
          productId,
          kind,
          payload,
          revisions,
          operationMarker: id,
          requestedBy: "pm",
        });
        return { id, binding: bindAction(kind, payload, revisions) };
      })
      .immediate();
  }
  approve(product: string, id: string, binding: string) {
    this.db
      .transaction(() => {
        const store = new ActionStore(this.db),
          a = store.read(id);
        const payload = a.payload as Route & { productId: string };
        if (
          a.kind !== "model_outside_allowlist" ||
          payload.productId !== product ||
          a.state !== "pending_approval" ||
          bindAction(a.kind, a.payload, this.revisions(product, payload)) !==
            binding ||
          bindAction(a.kind, a.payload, a.revisions) !== binding
        )
          throw new AuthoringError("Review the current route and allowlist.");
        store.approve(id, "pm");
        if (!store.claim(a.kind, id))
          throw new AuthoringError("Approval was unavailable.");
        const models = [...new Set([...this.policy(product), payload.model])];
        if (models.length > 100)
          throw new AuthoringError("Product model limit reached.");
        this.db
          .prepare("UPDATE products SET allowed_models_json=? WHERE id=?")
          .run(JSON.stringify(models), product);
        this.put(product, payload);
        store.finish(id, "succeeded");
      })
      .immediate();
  }
  resolve(
    product: string,
    task: Route["task"],
    level: Route["difficulty"],
    fallback: string,
  ) {
    const model =
      this.list(product).find((r) => r.task === task && r.difficulty === level)
        ?.model ?? fallback;
    if (!this.policy(product).includes(model))
      throw new AuthoringError("Choose a model allowed for this product.");
    return model;
  }
}
