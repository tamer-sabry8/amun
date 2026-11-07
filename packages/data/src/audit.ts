import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  Redactor,
  type createSafeLogger,
} from "../../security/src/redaction.ts";
type Actor = "pm" | "firstmate" | "worker" | "system";
export class SafeOutputs {
  private readonly db: Database.Database;
  private readonly redactor: Redactor;
  private readonly logger: ReturnType<typeof createSafeLogger>;
  constructor(
    db: Database.Database,
    redactor: Redactor,
    logger: ReturnType<typeof createSafeLogger>,
  ) {
    this.db = db;
    this.redactor = redactor;
    this.logger = logger;
  }
  audit(actor: Actor, event: string, ref: string, details: unknown): void {
    if (
      !["pm", "firstmate", "worker", "system"].includes(actor) ||
      !event ||
      event.length > 128 ||
      ref.length > 256
    )
      throw Error("Invalid audit metadata");
    const safe = this.redactor.clean(details);
    this.db
      .prepare(
        "INSERT INTO audit_log(id,at,actor,event,ref,details_json) VALUES (?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        new Date().toISOString(),
        actor,
        this.redactor.text(event),
        this.redactor.text(ref),
        JSON.stringify(safe),
      );
    this.logger.info(event, { actor, ref, details: safe });
  }
  exportAudit(): string {
    return JSON.stringify(
      this.redactor.clean(
        this.db.prepare("SELECT * FROM audit_log ORDER BY at,id").all(),
      ),
    );
  }
  memory(input: {
    id: string;
    productId: string;
    sourceId: string;
    type: string;
    data: unknown;
  }): void {
    // Require provenance in this product, rather than merely accepting a source from another workspace product.
    if (
      !this.db
        .prepare("SELECT id FROM sources WHERE id=? AND product_id=?")
        .get(input.sourceId, input.productId)
    )
      throw Error("Memory provenance unavailable");
    this.db
      .prepare(
        "INSERT INTO memory_entities(id,product_id,type,data_json,source_id,confidence,confirmed,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        input.id,
        input.productId,
        this.redactor.text(input.type),
        JSON.stringify(this.redactor.clean(input.data)),
        input.sourceId,
        0,
        0,
        new Date().toISOString(),
      );
  }
  update(productId: string, kind: string, text: string, ref: string): void {
    this.db
      .prepare(
        "INSERT INTO notifications(id,product_id,kind,text,ref,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        productId,
        this.redactor.text(kind),
        this.redactor.text(text),
        this.redactor.text(ref),
        new Date().toISOString(),
      );
  }
}
