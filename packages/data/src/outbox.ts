import { readNotionReceipt } from "./notion-receipt.ts";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  approveAction,
  bindAction,
  canExecute,
  canonicalJson,
  mutateAction,
  transition,
  type Action,
  type ActionKind,
  type ActionState,
} from "../../domain/src/governance.ts";
export interface Proposal {
  id: string;
  productId: string | null;
  kind: ActionKind;
  payload: unknown;
  revisions: unknown;
  requestedBy: string;
  operationMarker: string;
}
export interface StoredAction extends Action {
  operationMarker: string;
}
interface Row {
  id: string;
  kind: ActionKind;
  payload_json: string;
  target_revisions_json: string;
  state: ActionState;
  operation_marker: string;
}
export class ActionStore {
  private readonly db: Database.Database;
  constructor(db: Database.Database) {
    this.db = db;
  }
  read(id: string): StoredAction {
    const row = this.db.prepare("SELECT * FROM actions WHERE id=?").get(id) as
      Row | undefined;
    if (!row) throw new Error("Action not found");
    return {
      id: row.id,
      kind: row.kind,
      payload: JSON.parse(row.payload_json),
      revisions: JSON.parse(row.target_revisions_json),
      state: row.state,
      operationMarker: row.operation_marker,
    };
  }
  propose(input: Proposal): void {
    for (const value of [input.id, input.requestedBy, input.operationMarker])
      if (typeof value !== "string" || !value.trim() || value.length > 256)
        throw new Error("Invalid action identity");
    if (input.productId === null) {
      if (
        input.kind !== "notion_publish" &&
        input.kind !== "github_issue" &&
        !(
          input.kind === "publish" &&
          (input.payload as { destination?: unknown } | null)?.destination ===
            "exports/" + input.id + ".pdf" &&
          (input.revisions as { product?: unknown } | null)?.product === null
        )
      )
        throw Error("Product scope required");
    } else if (
      typeof input.productId !== "string" ||
      !input.productId.trim() ||
      input.productId.length > 256
    ) {
      throw Error("Invalid action scope");
    }
    const binding = bindAction(input.kind, input.payload, input.revisions);
    this.db
      .transaction(() => {
        this.db
          .prepare(
            "INSERT INTO actions(id,product_id,kind,payload_json,payload_hash,target_revisions_json,state,requested_by,operation_marker) VALUES (?,?,?,?,?,?,?,?,?)",
          )
          .run(
            input.id,
            input.productId,
            input.kind,
            canonicalJson(input.payload),
            binding,
            canonicalJson(input.revisions),
            transition("proposed", "pending_approval"),
            input.requestedBy,
            input.operationMarker,
          );
        this.db
          .prepare(
            "INSERT INTO outbox(id,action_id,step,attempt,state) VALUES (?,?,?,?,?)",
          )
          .run(randomUUID(), input.id, "execute", 0, "waiting");
      })
      .immediate();
  }
  approve(id: string, actor: string): void {
    this.db
      .transaction(() => {
        const { approval } = approveAction(
          this.read(id),
          actor,
          new Date().toISOString(),
        );
        this.db
          .prepare(
            "INSERT INTO approvals(id,action_id,decision,kind,payload_hash,target_revisions_json,approved_by,approved_at) VALUES (?,?,?,?,?,?,?,?)",
          )
          .run(
            randomUUID(),
            id,
            "approve",
            approval.kind,
            approval.binding,
            canonicalJson(this.read(id).revisions),
            actor,
            approval.approvedAt,
          );
        this.db
          .prepare("UPDATE actions SET state='approved' WHERE id=?")
          .run(id);
        this.db
          .prepare("UPDATE outbox SET state='ready' WHERE action_id=?")
          .run(id);
      })
      .immediate();
  }
  private invalidate(id: string): void {
    this.db
      .prepare(
        "UPDATE approvals SET invalidated_reason='Action binding changed' WHERE action_id=? AND invalidated_reason IS NULL",
      )
      .run(id);
    this.db
      .prepare("UPDATE actions SET state='invalidated' WHERE id=?")
      .run(id);
    this.db
      .prepare("UPDATE outbox SET state='waiting' WHERE action_id=?")
      .run(id);
  }
  edit(id: string, payload: unknown, revisions: unknown): void {
    this.db
      .transaction(() => {
        const previous = this.read(id);
        const edited = mutateAction(previous, payload, revisions);
        if (edited.state === "invalidated" && previous.state === "approved")
          this.invalidate(id);
        this.db
          .prepare(
            "UPDATE actions SET payload_json=?,payload_hash=?,target_revisions_json=?,state=? WHERE id=?",
          )
          .run(
            canonicalJson(payload),
            bindAction(edited.kind, payload, revisions),
            canonicalJson(revisions),
            edited.state,
            id,
          );
      })
      .immediate();
  }
  requestApproval(id: string): void {
    this.db
      .transaction(() => {
        const state = transition(this.read(id).state, "pending_approval");
        this.db.prepare("UPDATE actions SET state=? WHERE id=?").run(state, id);
      })
      .immediate();
  }
  claim(kind?: ActionKind, actionId?: string): StoredAction | undefined {
    return this.db
      .transaction(() => {
        const row = this.db
          .prepare(
            "SELECT o.action_id FROM outbox o JOIN actions a ON a.id=o.action_id WHERE o.state='ready' AND a.kind<>'pi_tool_review' AND (? IS NULL OR a.kind=?) AND (? IS NULL OR a.id=?) ORDER BY o.rowid LIMIT 1",
          )
          .get(
            kind ?? null,
            kind ?? null,
            actionId ?? null,
            actionId ?? null,
          ) as { action_id: string } | undefined;
        if (!row) return;
        const action = this.read(row.action_id);
        const approval = this.db
          .prepare(
            "SELECT action_id AS actionId,kind,payload_hash AS binding,approved_by AS approvedBy,approved_at AS approvedAt FROM approvals WHERE action_id=? AND invalidated_reason IS NULL AND decision='approve' ORDER BY rowid DESC LIMIT 1",
          )
          .get(action.id) as Parameters<typeof canExecute>[1] | undefined;
        if (!approval || !canExecute(action, approval)) {
          this.invalidate(action.id);
          return;
        }
        this.db
          .prepare("UPDATE actions SET state=? WHERE id=?")
          .run(transition(action.state, "executing"), action.id);
        this.db
          .prepare(
            "UPDATE outbox SET state='executing',attempt=attempt+1 WHERE action_id=?",
          )
          .run(action.id);
        return { ...action, state: "executing" as const };
      })
      .immediate();
  }
  /** Called once on service startup, before dispatch. Never spawns remote work. */
  recover(): void {
    this.db
      .transaction(() => {
        this.db
          .prepare(
            "UPDATE actions SET state='unknown' WHERE id IN (SELECT action_id FROM outbox WHERE state='executing') AND state='executing'",
          )
          .run();
        this.db
          .prepare(
            "UPDATE outbox SET state='unknown',last_error='Service interrupted before acknowledgement' WHERE state='executing'",
          )
          .run();
        const interrupted = this.db
          .prepare(
            "SELECT a.id,a.operation_marker FROM actions a JOIN outbox o ON o.action_id=a.id WHERE a.kind='notion_publish' AND a.state='unknown' AND o.state='unknown'",
          )
          .all() as { id: string; operation_marker: string }[];
        for (const action of interrupted) {
          if (readNotionReceipt(this.db, action.operation_marker))
            this.finish(action.id, "succeeded");
        }
      })
      .immediate();
  }
  uncertain(kind?: ActionKind, actionId?: string): StoredAction | undefined {
    const row = this.db
      .prepare(
        "SELECT o.action_id FROM outbox o JOIN actions a ON a.id=o.action_id WHERE o.state='unknown' AND (? IS NULL OR a.kind=?) AND (? IS NULL OR a.id=?) ORDER BY o.rowid LIMIT 1",
      )
      .get(kind ?? null, kind ?? null, actionId ?? null, actionId ?? null) as
      { action_id: string } | undefined;
    return row ? this.read(row.action_id) : undefined;
  }
  finish(id: string, state: "succeeded" | "failed" | "unknown"): void {
    this.db
      .transaction(() => {
        const action = this.read(id);
        transition(action.state, state);
        this.db.prepare("UPDATE actions SET state=? WHERE id=?").run(state, id);
        this.db
          .prepare("UPDATE outbox SET state=?,last_error=? WHERE action_id=?")
          .run(
            state,
            state === "unknown" ? "External result unconfirmed" : null,
            id,
          );
      })
      .immediate();
  }
}
export interface Connector {
  kind: ActionKind;
  execute(action: StoredAction): Promise<void>;
  reconcile(
    operationMarker: string,
  ): Promise<{ state: "found" | "absent" | "unknown" }>;
}
/** One bounded dispatch step; unknown outcomes only reconcile, never repeat execute. */
export async function dispatchOne(
  store: ActionStore,
  connector: Connector,
  actionId?: string,
): Promise<boolean> {
  const uncertain = store.uncertain(connector.kind, actionId);
  if (uncertain) {
    try {
      const result = await connector.reconcile(uncertain.operationMarker);
      if (result.state === "found") store.finish(uncertain.id, "succeeded");
      else if (result.state === "absent") store.finish(uncertain.id, "failed");
    } catch {
      /* Keep unknown; do not log potentially credential-bearing connector errors. */
    }
    return true;
  }
  const action = store.claim(connector.kind, actionId);
  if (!action) return false;
  try {
    await connector.execute(action);
    store.finish(action.id, "succeeded");
  } catch {
    store.finish(action.id, "unknown");
  }
  return true;
}
