import type Database from "better-sqlite3";
import {
  readNotionReceipt,
  receiptKey,
  publication,
} from "./notion-receipt.ts";
import { type NotionPublication } from "../../connectors-notion/src/client.ts";
import { ActionStore, type Connector, type StoredAction } from "./outbox.ts";
import { canonicalJson } from "../../domain/src/governance.ts";
/** An uncertain create is never repeated. Missing receipts remain unknown for explicit reconciliation. */
export class NotionOutboxConnector implements Connector {
  readonly kind = "notion_publish" as const;
  constructor(
    private readonly db: Database.Database,
    private readonly publisher: {
      create(
        input: NotionPublication,
        context: { workspaceId: string },
      ): Promise<import("../../connectors-notion/src/client.ts").NotionResult>;
    },
  ) {}
  receipt(marker: string) {
    return readNotionReceipt(this.db, marker);
  }
  async execute(action: StoredAction) {
    const stored = new ActionStore(this.db).read(action.id);
    if (
      stored.kind !== this.kind ||
      stored.state !== "executing" ||
      canonicalJson(stored) !== canonicalJson(action)
    )
      throw Error("Publication is not claimed");
    const payload = publication(stored.payload);
    if (
      this.db
        .prepare("SELECT id FROM workspace_settings WHERE id=?")
        .get(receiptKey(stored.operationMarker))
    )
      throw Error("Publication already has a receipt");
    const revisions = stored.revisions as { workspaceId?: unknown };
    const result = await this.publisher.create(payload, {
      workspaceId:
        typeof revisions?.workspaceId === "string" ? revisions.workspaceId : "",
    });
    if (result.state !== "created")
      throw Error("Publication outcome is unknown");
    this.db
      .prepare("INSERT INTO workspace_settings(id,value_json) VALUES (?,?)")
      .run(
        receiptKey(stored.operationMarker),
        JSON.stringify({
          pageId: result.pageId,
          parentId: payload.parentId,
          contentHash: payload.contentHash,
          ...(payload.parentType ? { parentType: payload.parentType } : {}),
          ...(payload.titleProperty
            ? { titleProperty: payload.titleProperty }
            : {}),
        }),
      );
  }
  async reconcile(marker: string): Promise<{ state: "found" | "unknown" }> {
    return { state: this.receipt(marker) ? "found" : "unknown" };
  }
}
