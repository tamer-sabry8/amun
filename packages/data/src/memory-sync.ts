import { ActionStore } from "./outbox.ts";
import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import {
  memoryLink,
  type SyncCommand,
  syncValue,
  type MemoryLink,
} from "../../contracts/src/memory-sync.ts";
import { syncState, type RemoteField } from "../../domain/src/memory-sync.ts";
import {
  notionTargetReference,
  uuidFromReference,
} from "../../auth/src/notion-result.ts";
import type { NotionConnection } from "../../auth/src/notion-connection.ts";
import { AttentionStore } from "./attention-store.ts";
import { Redactor } from "../../security/src/redaction.ts";

export class MemorySync {
  constructor(
    private db: Database.Database,
    private selected: () => string | null,
    private redactor = new Redactor(),
  ) {}
  list(product: string): MemoryLink[] {
    return this.db
      .prepare(
        `SELECT s.id,s.local_ref AS record,m.field,m.label,s.remote_id AS page,s.state,m.baseline,m.remote,e.data_json
     FROM sync_links s JOIN notion_memory_fields m ON m.link_id=s.id JOIN memory_entities e ON e.id=s.local_ref AND e.product_id=m.product_id
     WHERE m.product_id=? ORDER BY s.rowid`,
      )
      .all(product)
      .map((raw) => {
        const row = raw as Record<string, string>;
        return memoryLink.parse({
          ...row,
          local: JSON.parse(row.data_json!)[row.field!],
        });
      });
  }
  async run(
    input: SyncCommand,
    provider: Pick<NotionConnection, "memoryField">,
  ) {
    const active = () => {
      if (this.selected() !== input.productId) throw Error("Product changed");
    };
    active();
    if (input.action === "link-memory") {
      const row = this.db
        .prepare(
          "SELECT data_json FROM memory_entities WHERE id=? AND product_id=?",
        )
        .get(input.record, input.productId) as
        { data_json: string } | undefined;
      if (!row || !Object.hasOwn(JSON.parse(row.data_json), input.field))
        throw Error("Choose a text field");
      syncValue.parse(JSON.parse(row.data_json)[input.field]);
      const page = uuidFromReference(notionTargetReference(input.url));
      this.db
        .transaction(() => {
          if (
            this.db
              .prepare(
                "SELECT 1 FROM notion_memory_fields f JOIN sync_links l ON l.id=f.link_id WHERE (l.local_ref=? AND f.field=?) OR (l.remote_id=? AND f.label=?)",
              )
              .get(input.record, input.field, page, input.label)
          )
            throw Error("Field already linked");
          const id = randomUUID();
          this.db
            .prepare(
              "INSERT INTO sync_links(id,local_ref,remote_system,remote_id,state) VALUES(?,?,'notion-memory',?,'pending')",
            )
            .run(id, input.record, page);
          this.db
            .prepare(
              "INSERT INTO notion_memory_fields(link_id,product_id,field,label) VALUES(?,?,?,?)",
            )
            .run(id, input.productId, input.field, input.label);
        })
        .immediate();
      return;
    }
    const current = () => {
      active();
      const row = this.list(input.productId).find((l) => l.id === input.link);
      if (!row) throw Error("Link unavailable");
      return row;
    };
    const link = current();
    const changeLocal = (value: string) =>
      this.db
        .prepare(
          "UPDATE memory_entities SET data_json=json_set(data_json,?,?),updated_at=? WHERE id=? AND product_id=?",
        )
        .run(
          "$." + link.field,
          value,
          new Date().toISOString(),
          link.record,
          input.productId,
        );
    if (input.action === "edit-memory-field") {
      if (input.before !== link.local) throw Error("Local field changed");
      const clean = this.redactor.text(input.value);
      this.db
        .transaction(() => {
          changeLocal(clean);
          this.db
            .prepare("UPDATE sync_links SET state='pending' WHERE id=?")
            .run(link.id);
        })
        .immediate();
      return;
    }
    const assertCurrent = () => {
      if (JSON.stringify(current()) !== JSON.stringify(input.review))
        throw Error("Review changed");
    };
    assertCurrent();
    const settle = () =>
      this.db
        .prepare(
          "UPDATE attention_items SET state='resolved',resolved_at=?,resolved_by='pm' WHERE id=? AND state<>'resolved'",
        )
        .run(new Date().toISOString(), "sync-" + link.id);
    if (input.choice === "unlink") {
      this.db
        .transaction(() => {
          settle();
          this.db.prepare("DELETE FROM sync_links WHERE id=?").run(link.id);
        })
        .immediate();
      return;
    }
    const { workspace_id } = this.db
      .prepare("SELECT workspace_id FROM notion_memory_fields WHERE link_id=?")
      .get(link.id) as { workspace_id: string | null };
    let remote: RemoteField,
      workspace: string | null = workspace_id;
    const publish = input.choice === "publish-local";
    if (
      publish &&
      (link.remote === null ||
        !["outgoing", "conflict"].includes(link.state) ||
        this.redactor.text(link.local) !== link.local)
    )
      throw Error("Refresh and review");
    const store = new ActionStore(this.db);
    let writeId: string | undefined;
    const approveWrite = () => {
      assertCurrent();
      if (writeId) throw Error("Write already claimed");
      const id = randomUUID();
      this.db
        .transaction(() => {
          if (
            this.db
              .prepare(
                "SELECT id FROM actions WHERE kind='publish' AND product_id=? AND state IN ('unknown','executing') AND json_extract(payload_json,'$.memoryLink')=?",
              )
              .get(input.productId, link.id)
          )
            throw Error("Unconfirmed sync requires reconciliation");
          store.propose({
            id,
            kind: "publish",
            productId: input.productId,
            payload: {
              memoryLink: link.id,
              page: link.page,
              label: link.label,
              before: link.remote,
              after: link.local,
            },
            revisions: { baseline: link.baseline, workspace: workspace_id },
            operationMarker: id,
            requestedBy: "pm",
          });
          store.approve(id, "pm");
          if (!store.claim("publish", id))
            throw Error("Sync approval unavailable");
        })
        .immediate();
      writeId = id;
    };
    try {
      const result = await provider.memoryField({
        page: link.page,
        label: link.label,
        expectedWorkspace: workspace_id,
        ...(publish
          ? {
              edit: {
                before: link.remote!,
                after: link.local,
                assertCurrent: approveWrite,
              },
            }
          : {}),
      });
      remote = result.remote;
      workspace = result.workspace;
    } catch {
      remote = { kind: "unavailable" };
    }
    if (writeId)
      store.finish(
        writeId,
        remote.kind === "value" && remote.value === link.local
          ? "succeeded"
          : "unknown",
      );
    assertCurrent();
    this.db
      .transaction(() => {
        if (remote.kind === "value") {
          const uncertain = this.db
            .prepare(
              "SELECT id FROM actions WHERE product_id=? AND state='unknown' AND kind='publish' AND json_extract(payload_json,'$.memoryLink')=? AND json_extract(payload_json,'$.after')=?",
            )
            .all(input.productId, link.id, remote.value) as { id: string }[];
          for (const a of uncertain) store.finish(a.id, "succeeded");
        }
        if (
          input.choice === "keep-local" &&
          remote.kind === "deleted" &&
          link.state === "deleted"
        ) {
          this.db
            .prepare("UPDATE sync_links SET state='kept' WHERE id=?")
            .run(link.id);
          settle();
          return;
        }
        const state = syncState(link.baseline, link.local, remote);
        if (
          input.choice === "delete-local" &&
          state === "deleted" &&
          link.state === "deleted"
        ) {
          settle();
          this.db.prepare("DELETE FROM sync_links WHERE id=?").run(link.id);
          this.db
            .prepare(
              "UPDATE memory_entities SET data_json=json_remove(data_json,?),updated_at=? WHERE id=? AND product_id=?",
            )
            .run(
              "$." + link.field,
              new Date().toISOString(),
              link.record,
              input.productId,
            );
          return;
        }
        const take =
          input.choice === "take-remote" &&
          remote.kind === "value" &&
          remote.value === link.remote &&
          ["incoming", "conflict"].includes(link.state);
        if (take && remote.kind === "value")
          changeLocal(this.redactor.text(remote.value));
        const synced =
          remote.kind === "value" &&
          (state === "synced" ||
            (take && this.redactor.text(remote.value) === remote.value));
        const baseline =
          synced && remote.kind === "value" ? remote.value : link.baseline;
        const now = new Date().toISOString();
        const unknown = this.db
          .prepare(
            "SELECT 1 FROM actions WHERE product_id=? AND kind='publish' AND state='unknown' AND json_extract(payload_json,'$.memoryLink')=?",
          )
          .get(input.productId, link.id);
        const next = unknown ? "unconfirmed" : synced ? "synced" : state;
        this.db
          .prepare(
            "UPDATE notion_memory_fields SET workspace_id=?,baseline=?,remote=? WHERE link_id=?",
          )
          .run(
            workspace,
            baseline,
            remote.kind === "value" ? this.redactor.text(remote.value) : null,
            link.id,
          );
        this.db
          .prepare(
            "UPDATE sync_links SET state=?,local_hash=?,last_synced_at=CASE WHEN ? THEN ? ELSE last_synced_at END WHERE id=?",
          )
          .run(
            next,
            baseline === null
              ? null
              : createHash("sha256").update(baseline).digest("hex"),
            Number(synced),
            now,
            link.id,
          );
        if (next === "conflict" || next === "deleted") {
          const id = "sync-" + link.id;
          if (
            !this.db
              .prepare("SELECT id FROM attention_items WHERE id=?")
              .get(id)
          )
            new AttentionStore(this.db).create({
              id,
              productId: input.productId,
              type: "resolve_conflict",
              origin: { kind: "amun", label: "Notion", firstmateRef: null },
              ask: "Resolve Notion field: " + link.label,
              detail: "Review both values in the product overview.",
              blocking: [],
              primaryAction: {
                label: "Review field",
                mode: "navigate",
                intent: "open_request",
                targetRef: id,
              },
              governed: true,
              state: "open",
              snoozedUntil: null,
              createdAt: now,
            });
          else
            this.db
              .prepare(
                "UPDATE attention_items SET state='open',resolved_at=NULL,resolved_by=NULL WHERE id=?",
              )
              .run(id);
        } else if (synced) settle();
      })
      .immediate();
  }
}
