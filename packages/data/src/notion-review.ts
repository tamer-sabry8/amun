import { publication } from "./notion-receipt.ts";
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
      marksSendBoundary?: true;
      create(
        input: NotionPublication,
        context: { workspaceId: string; beforeSend(): void },
      ): Promise<NotionResult>;
    },
  ) {
    this.store = new ActionStore(db);
    this.connector = new NotionOutboxConnector(db, publisher);
  }
  unconfirmed(
    productId: string | null = null,
  ): { id: string; title: string }[] {
    return this.db
      .prepare(
        "SELECT id,json_extract(payload_json,'$.title') AS title FROM actions WHERE product_id IS ? AND kind='notion_publish' AND state='unknown' AND json_type(payload_json,'$.title')='text' AND length(json_extract(payload_json,'$.title')) BETWEEN 1 AND 256 ORDER BY rowid DESC LIMIT 50",
      )
      .all(productId) as { id: string; title: string }[];
  }
  deliveryState(id: string) {
    return (
      this.db
        .prepare("SELECT state FROM notion_delivery WHERE action_id=?")
        .get(id) as
        { state: "not sent" | "sent-unknown" | "confirmed" } | undefined
    )?.state;
  }
  nextCheck() {
    return (
      this.db
        .prepare(
          "SELECT a.id FROM actions a JOIN notion_delivery d ON d.action_id=a.id WHERE a.state='unknown' AND a.id=a.operation_marker AND d.state='sent-unknown' AND d.check_after<=? ORDER BY d.check_after,a.rowid LIMIT 1",
        )
        .get(Date.now()) as { id: string } | undefined
    )?.id;
  }
  async check(
    id: string,
    lookup: (
      intent: import("../../auth/src/notion-recovery.ts").PublicationLookup,
      workspaceId: string,
      url?: string,
    ) => Promise<string | undefined>,
    url?: string,
  ) {
    const action = this.store.read(id);
    if (
      action.kind !== "notion_publish" ||
      action.state !== "unknown" ||
      action.operationMarker !== id ||
      this.deliveryState(id) !== "sent-unknown"
    )
      throw Error("No searchable publication intent");
    const payload = publication(action.payload);
    const claim = this.db
      .prepare(
        "UPDATE notion_delivery SET check_after=?+MIN(3600000,30000*(1 << MIN(attempts,7))), attempts=attempts+1 WHERE action_id=? AND state='sent-unknown' AND (check_after<=? OR ?=1)",
      )
      .run(Date.now(), id, Date.now(), url ? 1 : 0);
    if (!claim.changes) return "wait" as const;
    const workspaceId = (action.revisions as { workspaceId: string })
      .workspaceId;
    try {
      const pageId = await lookup(
        {
          marker: id,
          parentType: payload.parentType ?? "page_id",
          parentId: payload.parentId,
          property: !!payload.markerPropertyId,
        },
        workspaceId,
        url,
      );
      if (!pageId) return "missing" as const;
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(pageId))
        throw Error("Invalid page identity");
      this.db
        .transaction(() => {
          if (this.deliveryState(id) === "confirmed") return;
          this.connector.saveReceipt(action, pageId);
          this.store.finish(id, "succeeded");
        })
        .immediate();
      return "confirmed" as const;
    } catch {
      return "blocked" as const;
    }
  }
  receipts(productId: string | null = null) {
    const rows = this.db
      .prepare(
        "SELECT id FROM actions WHERE product_id IS ? AND kind='notion_publish' AND state='succeeded' ORDER BY rowid DESC LIMIT 50",
      )
      .all(productId) as { id: string }[];
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
    productId: string | null = null,
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
    const id = randomUUID();
    const property =
      target.parentType === "data_source_id" &&
      target.markerPropertyAvailable === true;
    const text = property
      ? preview.text
      : preview.text + "\n\nAmun publication ID: " + id;
    if (text.length > 262144) throw Error("Publication exceeds review limit");
    const payload = {
      title: preview.title,
      text,
      ...(property ? { markerPropertyId: id } : {}),
      parentId: target.parentId,
      parentType: target.parentType,
      titleProperty: target.titleProperty,
      contentHash: createHash("sha256")
        .update(JSON.stringify([preview.title, text]))
        .digest("hex"),
    };

    const revisions = {
      workspaceId,
      destinationTitle: target.title,
      ...(productId ? { productId } : {}),
    };
    const binding = bindAction("notion_publish", payload, revisions);
    this.store.propose({
      id,
      productId,
      kind: "notion_publish",
      payload,
      revisions,
      requestedBy: "user",
      operationMarker: id,
    });
    return {
      id,
      binding,
      title: preview.title,
      text,
      ...(property ? { markerPropertyId: id } : {}),
      destination: target.title,
    };
  }
  restore(
    target: NotionDestination,
    workspaceId: string,
    productId: string | null = null,
  ) {
    const row = this.db
      .prepare(
        "SELECT id,payload_hash AS binding FROM actions WHERE kind='notion_publish' AND product_id IS ? AND state='pending_approval' ORDER BY rowid DESC LIMIT 1",
      )
      .get(productId) as { id: string; binding: string } | undefined;
    if (!row) throw Error("No pending Notion review");
    const action = this.store.read(row.id);
    const payload = publication(action.payload);
    const revisions = action.revisions as {
      workspaceId?: string;
      destinationTitle?: string;
      productId?: string;
    };
    if (
      action.operationMarker !== row.id ||
      bindAction(action.kind, action.payload, action.revisions) !==
        row.binding ||
      revisions.workspaceId !== workspaceId ||
      (revisions.productId ?? null) !== productId ||
      revisions.destinationTitle !== target.title ||
      payload.parentId !== target.parentId ||
      (payload.parentType ?? "page_id") !== target.parentType ||
      (payload.titleProperty ?? "title") !== target.titleProperty ||
      (payload.markerPropertyId && !target.markerPropertyAvailable)
    )
      throw Error("Saved Notion review changed");
    const footer = "\n\nAmun publication ID: " + row.id;
    if (!payload.markerPropertyId && !payload.text.endsWith(footer))
      throw Error("Saved publication marker changed");
    return {
      id: row.id,
      binding: row.binding,
      title: payload.title,
      text: payload.text,
      draftText: payload.markerPropertyId
        ? payload.text
        : payload.text.slice(0, -footer.length),
      ...(payload.markerPropertyId
        ? { markerPropertyId: payload.markerPropertyId }
        : {}),
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
    this.store.approve(id, "user", binding);
    await dispatchOne(this.store, this.connector, id);
    return this.store.read(id).state;
  }
}
