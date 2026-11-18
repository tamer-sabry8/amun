import type { BoardColumn } from "@getpaseo/protocol/amun-rpc";
import type { PmStore, Sprint, Story } from "./pm-store.js";

// Native Linear (GraphQL) and Jira Cloud (REST) adapters. No live call happens
// without credentials the captain provides; every outward write needs an
// explicit captain approval passed by the caller (Firstmate hard rule 2).

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface RemoteIssue {
  id: string;
  key: string;
  title: string;
  column: BoardColumn;
  remoteStatus: string;
  sprintId: string | null;
}

export interface RemoteSprint {
  id: string;
  name: string;
  state: Sprint["state"];
  startsAt: string | null;
  endsAt: string | null;
}

export interface DeliveryAdapter {
  readonly system: "linear" | "jira";
  readonly account: string;
  listSprints(): Promise<RemoteSprint[]>;
  listIssues(): Promise<RemoteIssue[]>;
  createIssue(story: Story): Promise<RemoteIssue>;
  moveIssue(issue: { id: string; key: string }, column: BoardColumn): Promise<void>;
  addComment(issue: { id: string; key: string }, body: string): Promise<void>;
}

export class DeliveryApiError extends Error {
  constructor(
    public readonly system: string,
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`${system} API error ${status}: ${detail.slice(0, 300)}`);
    this.name = "DeliveryApiError";
  }
}

export class MissingCredentialError extends Error {
  constructor(public readonly variables: string[]) {
    super(`Missing credentials: set ${variables.join(", ")}`);
    this.name = "MissingCredentialError";
  }
}

export class CaptainApprovalRequiredError extends Error {
  constructor() {
    super("Writing to Linear or Jira needs the captain's explicit approval for this payload");
    this.name = "CaptainApprovalRequiredError";
  }
}

/** Per-account env var: LINEAR_API_KEY, or LINEAR_API_KEY_<ACCOUNT> for extra accounts. */
export function credentialVar(base: string, account: string): string {
  return account === "default" ? base : `${base}_${account.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

// --- Linear ---------------------------------------------------------------------

export const LINEAR_ENDPOINT = "https://api.linear.app/graphql";

interface LinearState {
  id: string;
  name: string;
  type: string;
}

export function linearColumn(state: { name: string; type: string }): BoardColumn {
  switch (state.type) {
    case "completed":
    case "canceled":
      return "done";
    case "started":
      return /review/i.test(state.name) ? "review" : "in_progress";
    default:
      return "backlog";
  }
}

function linearStateFor(states: LinearState[], column: BoardColumn): LinearState | undefined {
  const byType = (type: string) => states.filter((s) => s.type === type);
  switch (column) {
    case "done":
      return byType("completed")[0];
    case "review":
      return byType("started").find((s) => /review/i.test(s.name)) ?? byType("started")[0];
    case "in_progress":
      return byType("started").find((s) => !/review/i.test(s.name)) ?? byType("started")[0];
    case "backlog":
      return byType("backlog")[0] ?? byType("unstarted")[0];
    default:
      return byType("unstarted")[0] ?? byType("backlog")[0];
  }
}

export interface LinearConfig {
  account: string;
  teamId: string;
  apiKey: string;
  fetch?: FetchLike;
}

export class LinearAdapter implements DeliveryAdapter {
  readonly system = "linear" as const;
  readonly account: string;
  private states: LinearState[] | null = null;

  constructor(private readonly config: LinearConfig) {
    this.account = config.account;
  }

  static fromEnv(input: { account?: string; teamId: string; env?: NodeJS.ProcessEnv; fetch?: FetchLike }) {
    const account = input.account ?? "default";
    const variable = credentialVar("LINEAR_API_KEY", account);
    const apiKey = (input.env ?? process.env)[variable];
    if (!apiKey) throw new MissingCredentialError([variable]);
    return new LinearAdapter({ account, teamId: input.teamId, apiKey, ...(input.fetch ? { fetch: input.fetch } : {}) });
  }

  private async gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const fetcher = this.config.fetch ?? fetch;
    const response = await fetcher(LINEAR_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: this.config.apiKey },
      body: JSON.stringify({ query, variables }),
    });
    const text = await response.text();
    if (!response.ok) throw new DeliveryApiError("linear", response.status, text);
    const json = JSON.parse(text) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new DeliveryApiError("linear", 200, json.errors.map((e) => e.message).join("; "));
    if (!json.data) throw new DeliveryApiError("linear", 200, "empty response");
    return json.data;
  }

  private async workflowStates(): Promise<LinearState[]> {
    if (this.states) return this.states;
    const data = await this.gql<{ team: { states: { nodes: LinearState[] } } }>(
      "query($teamId: String!) { team(id: $teamId) { states { nodes { id name type } } } }",
      { teamId: this.config.teamId },
    );
    this.states = data.team.states.nodes;
    return this.states;
  }

  async listSprints(): Promise<RemoteSprint[]> {
    const data = await this.gql<{
      team: {
        cycles: {
          nodes: {
            id: string;
            name: string | null;
            number: number;
            startsAt: string | null;
            endsAt: string | null;
            isActive: boolean;
            isFuture: boolean;
          }[];
        };
      };
    }>(
      "query($teamId: String!) { team(id: $teamId) { cycles(first: 50) { nodes { id name number startsAt endsAt isActive isFuture } } } }",
      { teamId: this.config.teamId },
    );
    return data.team.cycles.nodes.map((c) => ({
      id: c.id,
      name: c.name ?? `Cycle ${c.number}`,
      state: c.isActive ? "active" : c.isFuture ? "future" : "closed",
      startsAt: c.startsAt,
      endsAt: c.endsAt,
    }));
  }

  async listIssues(): Promise<RemoteIssue[]> {
    const issues: RemoteIssue[] = [];
    let after: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const data: {
        team: {
          issues: {
            nodes: {
              id: string;
              identifier: string;
              title: string;
              state: LinearState;
              cycle: { id: string } | null;
            }[];
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          };
        };
      } = await this.gql(
        "query($teamId: String!, $after: String) { team(id: $teamId) { issues(first: 50, after: $after) { nodes { id identifier title state { id name type } cycle { id } } pageInfo { hasNextPage endCursor } } } }",
        { teamId: this.config.teamId, after },
      );
      for (const node of data.team.issues.nodes) {
        issues.push({
          id: node.id,
          key: node.identifier,
          title: node.title,
          column: linearColumn(node.state),
          remoteStatus: node.state.name,
          sprintId: node.cycle?.id ?? null,
        });
      }
      if (!data.team.issues.pageInfo.hasNextPage) break;
      after = data.team.issues.pageInfo.endCursor;
    }
    return issues;
  }

  async createIssue(story: Story): Promise<RemoteIssue> {
    const state = linearStateFor(await this.workflowStates(), story.column);
    const data = await this.gql<{
      issueCreate: { success: boolean; issue: { id: string; identifier: string; title: string; state: LinearState } };
    }>(
      "mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title state { id name type } } } }",
      {
        input: {
          teamId: this.config.teamId,
          title: story.title,
          description: story.body,
          ...(state ? { stateId: state.id } : {}),
        },
      },
    );
    const issue = data.issueCreate.issue;
    return {
      id: issue.id,
      key: issue.identifier,
      title: issue.title,
      column: linearColumn(issue.state),
      remoteStatus: issue.state.name,
      sprintId: null,
    };
  }

  async moveIssue(issue: { id: string }, column: BoardColumn): Promise<void> {
    const state = linearStateFor(await this.workflowStates(), column);
    if (!state) throw new DeliveryApiError("linear", 422, `no workflow state for column ${column}`);
    await this.gql("mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }", {
      id: issue.id,
      stateId: state.id,
    });
  }

  async addComment(issue: { id: string }, body: string): Promise<void> {
    await this.gql("mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }", {
      input: { issueId: issue.id, body },
    });
  }
}

// --- Jira Cloud -----------------------------------------------------------------

export function jiraColumn(status: { name: string; statusCategory: { key: string } }): BoardColumn {
  switch (status.statusCategory.key) {
    case "done":
      return "done";
    case "indeterminate":
      return /review/i.test(status.name) ? "review" : "in_progress";
    default:
      return "backlog";
  }
}

const COLUMN_CATEGORY: Record<BoardColumn, string> = {
  backlog: "new",
  discovery: "new",
  spec: "new",
  in_progress: "indeterminate",
  review: "indeterminate",
  done: "done",
};

/** Atlassian Document Format for plain text. */
export function adf(text: string): unknown {
  return {
    type: "doc",
    version: 1,
    content: text
      .split(/\n{2,}/)
      .filter((p) => p.trim())
      .map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })),
  };
}

export interface JiraConfig {
  account: string;
  /** https://<site>.atlassian.net */
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  boardId: number;
  issueType?: string;
  fetch?: FetchLike;
}

export class JiraAdapter implements DeliveryAdapter {
  readonly system = "jira" as const;
  readonly account: string;

  constructor(private readonly config: JiraConfig) {
    this.account = config.account;
  }

  static fromEnv(input: {
    account?: string;
    baseUrl: string;
    projectKey: string;
    boardId: number;
    env?: NodeJS.ProcessEnv;
    fetch?: FetchLike;
  }) {
    const account = input.account ?? "default";
    const env = input.env ?? process.env;
    const emailVar = credentialVar("JIRA_EMAIL", account);
    const tokenVar = credentialVar("JIRA_API_TOKEN", account);
    const missing = [emailVar, tokenVar].filter((v) => !env[v]);
    if (missing.length) throw new MissingCredentialError(missing);
    return new JiraAdapter({
      account,
      baseUrl: input.baseUrl.replace(/\/+$/, ""),
      email: env[emailVar]!,
      apiToken: env[tokenVar]!,
      projectKey: input.projectKey,
      boardId: input.boardId,
      ...(input.fetch ? { fetch: input.fetch } : {}),
    });
  }

  private async request<T>(method: string, pathname: string, body?: unknown): Promise<T> {
    const fetcher = this.config.fetch ?? fetch;
    const auth = Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString("base64");
    const response = await fetcher(`${this.config.baseUrl}${pathname}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) throw new DeliveryApiError("jira", response.status, text);
    return (text ? JSON.parse(text) : {}) as T;
  }

  async listSprints(): Promise<RemoteSprint[]> {
    const data = await this.request<{
      values: { id: number; name: string; state: string; startDate?: string; endDate?: string }[];
    }>("GET", `/rest/agile/1.0/board/${this.config.boardId}/sprint?state=active,future`);
    return data.values.map((s) => ({
      id: String(s.id),
      name: s.name,
      state: s.state === "active" ? "active" : s.state === "future" ? "future" : "closed",
      startsAt: s.startDate ?? null,
      endsAt: s.endDate ?? null,
    }));
  }

  async listIssues(): Promise<RemoteIssue[]> {
    const issues: RemoteIssue[] = [];
    for (const sprint of await this.listSprints()) {
      const data = await this.request<{
        issues: {
          id: string;
          key: string;
          fields: { summary: string; status: { name: string; statusCategory: { key: string } } };
        }[];
      }>("GET", `/rest/agile/1.0/sprint/${sprint.id}/issue?fields=summary,status&maxResults=100`);
      for (const issue of data.issues) {
        issues.push({
          id: issue.id,
          key: issue.key,
          title: issue.fields.summary,
          column: jiraColumn(issue.fields.status),
          remoteStatus: issue.fields.status.name,
          sprintId: sprint.id,
        });
      }
    }
    return issues;
  }

  async createIssue(story: Story): Promise<RemoteIssue> {
    const created = await this.request<{ id: string; key: string }>("POST", "/rest/api/3/issue", {
      fields: {
        project: { key: this.config.projectKey },
        summary: story.title,
        issuetype: { name: this.config.issueType ?? "Story" },
        description: adf(story.body || story.title),
      },
    });
    if (story.sprintId) {
      const sprintRef = story.sprintId.replace(/^jira:/, "");
      await this.request("POST", `/rest/agile/1.0/sprint/${sprintRef}/issue`, { issues: [created.key] });
    }
    return { id: created.id, key: created.key, title: story.title, column: "backlog", remoteStatus: "", sprintId: story.sprintId };
  }

  async moveIssue(issue: { key: string }, column: BoardColumn): Promise<void> {
    const data = await this.request<{
      transitions: { id: string; name: string; to: { name: string; statusCategory: { key: string } } }[];
    }>("GET", `/rest/api/3/issue/${issue.key}/transitions`);
    const wanted = COLUMN_CATEGORY[column];
    const candidates = data.transitions.filter((t) => t.to.statusCategory.key === wanted);
    const transition =
      (column === "review" ? candidates.find((t) => /review/i.test(t.to.name)) : undefined) ??
      candidates.find((t) => !/review/i.test(t.to.name)) ??
      candidates[0];
    if (!transition) throw new DeliveryApiError("jira", 422, `no transition into ${column} for ${issue.key}`);
    await this.request("POST", `/rest/api/3/issue/${issue.key}/transitions`, { transition: { id: transition.id } });
  }

  async addComment(issue: { key: string }, body: string): Promise<void> {
    await this.request("POST", `/rest/api/3/issue/${issue.key}/comment`, { body: adf(body) });
  }
}

// --- Sync service ---------------------------------------------------------------

export interface PullResult {
  sprints: number;
  linked: number;
  moved: { storyId: string; to: BoardColumn }[];
  unlinked: string[];
}

export interface PushResult {
  created: { storyId: string; key: string }[];
  moved: { storyId: string; key: string; to: BoardColumn }[];
}

export class DeliverySync {
  constructor(
    private readonly store: PmStore,
    private readonly adapter: DeliveryAdapter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Read-only: load sprints and remote status for stories already linked. */
  async pull(): Promise<PullResult> {
    const sprints = await this.adapter.listSprints();
    for (const sprint of sprints) {
      this.store.upsertSprint({
        id: `${this.adapter.system}:${sprint.id}`,
        name: sprint.name,
        state: sprint.state,
        startsAt: sprint.startsAt,
        endsAt: sprint.endsAt,
        source: this.adapter.system,
        externalId: sprint.id,
      });
    }
    const result: PullResult = { sprints: sprints.length, linked: 0, moved: [], unlinked: [] };
    for (const issue of await this.adapter.listIssues()) {
      const story = this.store.storyForExternal(this.adapter.system, this.adapter.account, issue.id);
      if (!story) {
        result.unlinked.push(issue.key);
        continue;
      }
      result.linked += 1;
      this.store.linkExternal({
        storyId: story.id,
        system: this.adapter.system,
        account: this.adapter.account,
        externalId: issue.id,
        externalKey: issue.key,
        remoteStatus: issue.remoteStatus,
        syncedAt: this.now().toISOString(),
      });
      // Firstmate owns columns for backlog-backed stories; remote status only moves local-only ones.
      const sprintId = issue.sprintId ? `${this.adapter.system}:${issue.sprintId}` : story.sprintId;
      if (!story.backlogTaskId && story.column !== issue.column) {
        this.store.upsertStory({ ...story, column: issue.column, sprintId });
        result.moved.push({ storyId: story.id, to: issue.column });
      } else if (sprintId !== story.sprintId) {
        this.store.upsertStory({ ...story, sprintId });
      }
    }
    return result;
  }

  /** Outward write. Refused unless the captain approved this exact set of stories. */
  async push(storyIds: string[], approval: { approvedByCaptain: true; storyIds: string[] }): Promise<PushResult> {
    const approved = new Set(approval.storyIds);
    if (approval.approvedByCaptain !== true || storyIds.some((id) => !approved.has(id))) {
      throw new CaptainApprovalRequiredError();
    }
    const result: PushResult = { created: [], moved: [] };
    for (const id of storyIds) {
      const story = this.store.getStory(id);
      if (!story) continue;
      const link = this.store.externalLinks(id).find((l) => l.system === this.adapter.system);
      if (!link) {
        const issue = await this.adapter.createIssue(story);
        this.store.linkExternal({
          storyId: id,
          system: this.adapter.system,
          account: this.adapter.account,
          externalId: issue.id,
          externalKey: issue.key,
          remoteStatus: issue.remoteStatus,
          syncedAt: this.now().toISOString(),
        });
        result.created.push({ storyId: id, key: issue.key });
        if (issue.column !== story.column) {
          await this.adapter.moveIssue(issue, story.column);
          result.moved.push({ storyId: id, key: issue.key, to: story.column });
        }
      } else {
        const ref = { id: link.externalId, key: link.externalKey ?? link.externalId };
        await this.adapter.moveIssue(ref, story.column);
        result.moved.push({ storyId: id, key: ref.key, to: story.column });
      }
    }
    return result;
  }
}
