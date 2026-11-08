import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { bindAction } from "../../domain/src/governance.ts";
import { ActionStore, dispatchOne } from "./outbox.ts";
import { workspaceIdentity } from "./identity.ts";
export const issueFixture = {
  owner: "tamer-sabry8",
  repo: "amun",
  title: "Test: GitHub MCP write acceptance",
  body: "This test issue verifies that Amun creates a GitHub issue through the hosted MCP server after the workspace owner reviews and approves the exact content.",
} as const;
export class GithubIssueReview {
  constructor(private readonly db: Database.Database) {}
  prepare() {
    const store = new ActionStore(this.db);
    return this.db
      .transaction(() => {
        const existing = this.db
          .prepare("SELECT id FROM actions WHERE operation_marker=?")
          .get("github-issue-acceptance-v1") as { id: string } | undefined;
        const id = existing?.id ?? randomUUID();
        const revisions = { workspaceId: workspaceIdentity(this.db) };
        if (!existing)
          store.propose({
            id,
            productId: null,
            kind: "github_issue",
            payload: issueFixture,
            revisions,
            requestedBy: "user",
            operationMarker: "github-issue-acceptance-v1",
          });
        const a = store.read(id);
        if (
          a.state !== "pending_approval" ||
          bindAction(a.kind, a.payload, a.revisions) !==
            bindAction("github_issue", issueFixture, revisions)
        )
          throw Error("Existing issue attempt requires inspection");
        return {
          id,
          binding: bindAction("github_issue", issueFixture, revisions),
          ...issueFixture,
        };
      })
      .immediate();
  }
  async publish(
    id: string,
    binding: string,
    send: (issue: typeof issueFixture) => Promise<number>,
  ) {
    const item = this.prepare();
    if (item.id !== id || item.binding !== binding)
      throw Error("Invalid issue approval");
    const store = new ActionStore(this.db);
    store.approve(id, "user");
    await dispatchOne(
      store,
      {
        kind: "github_issue",
        execute: async (action) => {
          if (
            action.id !== id ||
            bindAction(action.kind, action.payload, action.revisions) !==
              binding
          )
            throw Error("Issue review changed");
          const number = await send(issueFixture);
          if (!Number.isSafeInteger(number) || number < 1)
            throw Error("Missing issue receipt");
          this.db
            .prepare(
              "INSERT INTO workspace_settings(id,value_json) VALUES (?,?)",
            )
            .run("github.issue.receipt." + id, JSON.stringify(number));
        },
        reconcile: async () => ({ state: "unknown" }),
      },
      id,
    );
    return store.read(id).state;
  }
  completedIssue() {
    const row = this.db
      .prepare(
        "SELECT id FROM actions WHERE kind='github_issue' AND state='succeeded' AND operation_marker='github-issue-acceptance-v1'",
      )
      .get() as { id: string } | undefined;
    if (!row) return null;
    const number = this.receipt(row.id);
    return number !== null && Number.isSafeInteger(number) && number > 0
      ? number
      : null;
  }
  receipt(id: string) {
    const row = this.db
      .prepare("SELECT value_json FROM workspace_settings WHERE id=?")
      .get("github.issue.receipt." + id) as { value_json: string } | undefined;
    return row ? Number(row.value_json) : null;
  }
}
