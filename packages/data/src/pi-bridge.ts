import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { BridgeRequest } from "../../contracts/src/pi-bridge.ts";
import type { Redactor } from "../../security/src/redaction.ts";
import { ActionStore } from "./outbox.ts";
import { AttentionStore } from "./attention-store.ts";
export function handleBridgeRequest(
  db: Database.Database,
  productId: string | null,
  redactor: Redactor,
) {
  const actions = new ActionStore(db),
    attention = new AttentionStore(db);
  return (request: BridgeRequest): string => {
    const product = productId
      ? (db
          .prepare("SELECT id,name FROM products WHERE id=?")
          .get(productId) as { id: string; name: string } | undefined)
      : undefined;
    if (request.op === "tool" && request.name === "amun_get_context")
      return JSON.stringify({
        product: product
          ? { id: product.id, name: redactor.text(product.name).slice(0, 256) }
          : null,
      });
    if (!product) throw Error("Select an Amun product");
    const id = randomUUID(),
      now = new Date().toISOString();
    if (request.op === "event") {
      if (request.name !== "mcp_replaced") {
        db.prepare(
          "INSERT INTO audit_log(id,at,actor,event,ref,details_json) VALUES (?,?, 'firstmate',?,?,'{}')",
        ).run(id, now, "pi." + request.name, product.id);
        return id;
      }
      db.prepare(
        "INSERT INTO notifications(id,product_id,kind,text,ref,created_at) VALUES (?,?,?,?,?,?)",
      ).run(
        id,
        product.id,
        "failure",
        "An extension replaced Pi’s MCP command. Amun blocked tool execution.",
        id,
        now,
      );
      return id;
    }
    const decision = request.name === "amun_raise_decision";
    if (
      request.op === "tool" &&
      (decision || request.name === "amun_report_blocker")
    ) {
      attention.create({
        id,
        productId: product.id,
        type: decision ? "decide" : "unblock",
        origin: { kind: "firstmate", label: "Firstmate", firstmateRef: null },
        ask: decision
          ? "Firstmate requests a decision"
          : "Firstmate reported a blocker",
        detail: redactor.text(request.summary),
        blocking: [],
        primaryAction: {
          label: "Review request",
          mode: "navigate",
          intent: "open_request",
          targetRef: id,
        },
        governed: false,
        state: "open",
        snoozedUntil: null,
        createdAt: now,
      });
      return id;
    }
    // Bridge requests need product-specific review before any connector can execute.
    // Never label an incomplete proposal as a ready-to-execute publish or merge.
    const payload =
      request.op === "gate"
        ? {
            tool: request.name,
            nested: request.nested,
            argumentsDigest: request.digest,
          }
        : { tool: request.name, summary: redactor.text(request.summary) };
    db.transaction(() => {
      actions.propose({
        id,
        productId: product.id,
        kind: "pi_tool_review",
        payload,
        revisions: {},
        requestedBy: "firstmate",
        operationMarker: id,
      });
      attention.create({
        id,
        productId: product.id,
        type: "review",
        origin: { kind: "firstmate", label: "Firstmate", firstmateRef: null },
        ask: "Review a proposed tool operation",
        detail: redactor.text(request.name),
        blocking: [],
        primaryAction: {
          label: "Review request",
          mode: "navigate",
          intent: "open_request",
          targetRef: id,
        },
        governed: true,
        state: "open",
        snoozedUntil: null,
        createdAt: now,
      });
    }).immediate();
    return id;
  };
}
