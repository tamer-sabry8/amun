import type Database from "better-sqlite3";
import {
  workspaceCommand,
  workspaceSnapshot,
  uiPreferences,
  type WorkspaceSnapshot,
  type WorkspaceEvent,
} from "../../contracts/src/workspace.ts";
import type { StatusActivity } from "../../contracts/src/entities.ts";
import { AttentionStore, searchEntities } from "./attention-store.ts";
export class WorkspaceService {
  private readonly db: Database.Database;
  private readonly attention: AttentionStore;
  constructor(db: Database.Database) {
    this.db = db;
    this.attention = new AttentionStore(db);
  }
  private preferences() {
    const row = this.db
      .prepare(
        "SELECT value_json FROM workspace_settings WHERE id='ui_preferences'",
      )
      .get() as { value_json: string } | undefined;
    return uiPreferences.parse(row ? JSON.parse(row.value_json) : {});
  }
  snapshot(): WorkspaceSnapshot {
    this.attention.wake(Date.now());
    const activities: StatusActivity[] = [];
    const runs = this.db
      .prepare(
        "SELECT id,product_id,agent_role,state FROM runs WHERE state IN ('queued','running','awaiting_decision','blocked','failed','unknown')",
      )
      .all() as {
      id: string;
      product_id: string;
      agent_role: string;
      state: string;
    }[];
    for (const run of runs)
      activities.push({
        id: "run-" + run.id,
        productId: run.product_id,
        kind: "run",
        state:
          run.state === "running"
            ? "working"
            : run.state === "failed"
              ? "failed"
              : "waiting",
        ref: run.id,
        text: run.agent_role,
      });
    const actions = this.db
      .prepare(
        "SELECT id,product_id,kind,state FROM actions WHERE state IN ('executing','unknown','failed')",
      )
      .all() as {
      id: string;
      product_id: string;
      kind: string;
      state: string;
    }[];
    for (const action of actions)
      activities.push({
        id: "action-" + action.id,
        productId: action.product_id,
        kind:
          action.state === "unknown"
            ? "reconciliation"
            : ["publish", "notion_publish"].includes(action.kind)
              ? "publication"
              : "action",
        state:
          action.state === "executing"
            ? "working"
            : action.state === "failed"
              ? "failed"
              : "waiting",
        ref: action.id,
        text: action.kind.replaceAll("_", " "),
      });
    return workspaceSnapshot.parse({
      version: 1,
      kind: "workspace-snapshot",
      preferences: this.preferences(),
      products: this.db
        .prepare("SELECT id,name FROM products ORDER BY created_at,id")
        .all(),
      attention: this.attention.list(null),
      activities,
      notifications: this.db
        .prepare(
          "SELECT id,product_id AS productId,kind,text,ref,read_at AS readAt,created_at AS createdAt FROM notifications ORDER BY created_at DESC,id",
        )
        .all(),
      artifacts: this.db
        .prepare(
          "SELECT id,product_id AS productId,kind,path_or_uri AS ref FROM artifacts ORDER BY rowid DESC",
        )
        .all(),
      skills: this.db
        .prepare(
          "SELECT id,name,version,approved_at AS approvedAt FROM skills ORDER BY name,id",
        )
        .all(),
    });
  }
  handle(input: unknown): WorkspaceEvent | undefined {
    const parsed = workspaceCommand.safeParse(input);
    if (!parsed.success) return;
    const command = parsed.data;
    try {
      if (command.action === "preferences") {
        if (
          command.preferences.productId !== null &&
          !this.db
            .prepare("SELECT id FROM products WHERE id=?")
            .get(command.preferences.productId)
        )
          throw Error("Unknown product");
        this.db
          .prepare(
            "INSERT INTO workspace_settings(id,value_json) VALUES ('ui_preferences',?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json",
          )
          .run(JSON.stringify(command.preferences));
      } else if (command.action === "snooze")
        this.attention.snooze(command.id, Date.parse(command.until));
      else if (command.action === "resolve")
        this.attention.resolve(command.id, command.source, command.answer);
      else if (command.action === "search")
        return {
          version: 1,
          kind: "workspace-search",
          query: command.query,
          results: searchEntities(this.db, command.productId, command.query),
        };
      return this.snapshot();
    } catch {
      return {
        version: 1,
        kind: "workspace-error",
        message:
          "The workspace change could not be completed. Refresh and try again.",
      };
    }
  }
}
