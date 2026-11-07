import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  NotionPublication,
  NotionResult,
} from "../../connectors-notion/src/client.ts";
import type { NotionDestination } from "../../auth/src/notion-result.ts";
import { bindAction } from "../../domain/src/governance.ts";
import { NotionOutboxConnector } from "./notion-publication.ts";
import { ActionStore, dispatchOne } from "./outbox.ts";
/** Accepts only service-retained redacted previews and service-verified destinations. */
export class NotionConversationReview {
  private readonly store: ActionStore;
  private readonly connector: NotionOutboxConnector;
  constructor(
    private readonly db: Database.Database,
    publisher: {
      create(
        input: NotionPublication,
        context: { workspaceId: string },
      ): Promise<NotionResult>;
    },
  ) {
    this.store = new ActionStore(db);
    this.connector = new NotionOutboxConnector(db, publisher);
  }
  unconfirmed(): { id: string; title: string }[] {
    return this.db
      .prepare(
        "SELECT id,json_extract(payload_json,'$.title') AS title FROM actions WHERE kind='notion_publish' AND state='unknown' AND json_type(payload_json,'$.title')='text' AND length(json_extract(payload_json,'$.title')) BETWEEN 1 AND 256 ORDER BY rowid DESC LIMIT 50",
      )
      .all() as { id: string; title: string }[];
  }
  receipts() {
    const rows = this.db
      .prepare(
        "SELECT id FROM actions WHERE kind='notion_publish' AND state='succeeded' ORDER BY rowid DESC LIMIT 50",
      )
      .all() as { id: string }[];
    return rows.flatMap(({ id }) => {
      const action = this.store.read(id);
      const receipt = this.connector.receipt(action.operationMarker);
      const title = (action.payload as { title?: unknown }).title;
      if (!receipt || typeof title !== "string" || title.length > 256)
        return [];
      return [
        {
          id,
          title,
          url: "https://www.notion.so/" + receipt.pageId.replaceAll("-", ""),
        },
      ];
    });
  }
  prepare(
    preview: { title: string; text: string },
    target: NotionDestination,
    workspaceId: string,
  ) {
    if (
      !preview.title.trim() ||
      preview.title.length > 256 ||
      !preview.text.trim() ||
      preview.text.length > 262144 ||
      /\0/.test(preview.title + preview.text) ||
      !workspaceId ||
      workspaceId.length > 128
    )
      throw Error("Invalid conversation review");
    const payload = {
      title: preview.title,
      text: preview.text,
      parentId: target.parentId,
      parentType: target.parentType,
      titleProperty: target.titleProperty,
      contentHash: createHash("sha256")
        .update(JSON.stringify([preview.title, preview.text]))
        .digest("hex"),
    };
    const id = randomUUID();
    const revisions = { workspaceId, destinationTitle: target.title };
    const binding = bindAction("notion_publish", payload, revisions);
    this.store.propose({
      id,
      productId: null,
      kind: "notion_publish",
      payload,
      revisions,
      requestedBy: "user",
      operationMarker: randomUUID(),
    });
    return {
      id,
      binding,
      title: preview.title,
      text: preview.text,
      destination: target.title,
    };
  }
  async publish(id: string, binding: string) {
    const action = this.store.read(id);
    if (
      action.kind !== "notion_publish" ||
      action.state !== "pending_approval" ||
      binding !== bindAction(action.kind, action.payload, action.revisions)
    )
      throw Error("Review is stale or already submitted");
    this.store.approve(id, "user");
    await dispatchOne(this.store, this.connector, id);
    return this.store.read(id).state;
  }
}
