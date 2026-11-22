// Jira through Atlassian's Rovo MCP server (v2). Checked live on 22 November
// 2026: createJiraIssue (projectKey, issueType, parent, labels,
// assignToSprint), getJiraIssue view "evidence" (parent, issuetype, labels,
// customFields.Sprint), searchJiraIssuesUsingJql, and through the execute
// family listJiraProjects, listJiraBoards, listJiraBoardSprints (read) and
// manageJiraSprint (create / addIssues / start, reached only through
// executeDestructive). Amun never calls manageJiraSprint update or close.
import { PlanRefused, type PlanReceipt } from "../plan-publication.ts";
import {
  earliest,
  realWait,
  settledSearch,
  type Wait,
  markerLabel,
  markerLine,
  obj,
  refusalText,
  requireTool,
  text,
  toolData,
  trackerBody,
  type TrackerSession,
  type TrackerStep,
} from "./tracker-items.ts";

/** A Jira site this grant can write to. */
export interface JiraSite {
  cloudId: string;
  /** Host, e.g. example.atlassian.net. */
  host: string;
}

const SPRINT_ACTIONS = new Set(["create", "addIssues", "start"]);
const KEY = /^[A-Z][A-Z0-9_]{0,9}-\d+$/;

/** The provider's payload, which Jira's MCP server nests under `data`. */
const payload = (result: Parameters<typeof toolData>[0]) => {
  const data = obj(toolData(result));
  return "data" in data ? obj(data.data) : data;
};

export class JiraWriter {
  constructor(
    private readonly session: TrackerSession,
    private readonly site: JiraSite,
    private readonly wait: Wait = realWait,
  ) {}

  private async call(name: string, args: Record<string, unknown>) {
    requireTool("jira", this.session, name);
    return this.session.call(name, { cloudId: this.site.cloudId, ...args });
  }

  /** A read; a refusal is an Error (the outcome stays uncertain). */
  private async read(name: string, args: Record<string, unknown>) {
    const result = await this.call(name, args);
    if (result.isError) throw Error(`Jira read ${name} failed`);
    return payload(result);
  }

  private async execute(
    kind: "executeRead" | "executeDestructive",
    name: string,
    inputs: Record<string, unknown>,
  ) {
    if (
      kind === "executeDestructive" &&
      (name !== "manageJiraSprint" ||
        !SPRINT_ACTIONS.has(String(inputs.action)))
    )
      throw Error("Unsupported Jira operation");
    return this.call(kind, { name, inputs });
  }

  url(key: string) {
    return `https://${this.site.host}/browse/${key}`;
  }

  /** The project's issue types; throws PlanRefused when it is not there. */
  async issueTypes(project: string): Promise<string[]> {
    const result = await this.execute("executeRead", "listJiraProjects", {
      query: project,
      expand: "issueTypes",
      action: "create",
    });
    if (result.isError) throw Error("Jira project list failed");
    const values = obj(payload(result)).values;
    const found = (Array.isArray(values) ? values : [])
      .map(obj)
      .find((p) => text(p.key)?.toUpperCase() === project);
    if (!found)
      throw new PlanRefused(
        `Jira refused it: project ${project} is not on ${this.site.host} or this account cannot create issues there`,
      );
    return (Array.isArray(found.issueTypes) ? found.issueTypes : [])
      .map(obj)
      .filter((t) => t.subtask !== true)
      .map((t) => String(t.name ?? ""))
      .filter(Boolean);
  }

  /** Stories use the requested type, or the project's own story-level type. */
  chooseType(step: TrackerStep, types: string[]) {
    const has = (name: string) =>
      types.find((t) => t.toLowerCase() === name.toLowerCase());
    if (step.kind === "epic") {
      const epic = has("Epic");
      if (!epic)
        throw new PlanRefused(
          `Jira refused it: project ${step.project} has no Epic type`,
        );
      return { type: epic, note: undefined };
    }
    const exact = has(step.issueType);
    if (exact) return { type: exact, note: undefined };
    const family = ["Story", "Task", "Feature"]
      .map(has)
      .find((t): t is string => !!t);
    if (!family || !/^(story|user story|backlog item)$/i.test(step.issueType))
      throw new PlanRefused(
        `Jira refused it: project ${step.project} has no ${step.issueType} type`,
      );
    return {
      type: family,
      note: `Created as ${family}: project ${step.project} has no ${step.issueType} type.`,
    };
  }

  /** One issue, as Jira holds it now. */
  async issue(key: string) {
    const data = await this.read("getJiraIssue", {
      issueIdOrKey: key,
      view: "evidence",
    });
    const fields = obj(data.fields);
    const sprints = obj(obj(fields.customFields).Sprint).value;
    return {
      key: text(data.key) ?? key,
      project: (text(data.key) ?? key).replace(/-\d+$/, ""),
      summary: text(fields.summary) ?? "",
      type: text(obj(fields.issuetype).name) ?? "",
      parent: text(obj(fields.parent).key),
      labels: (Array.isArray(fields.labels) ? fields.labels : []).map(String),
      sprints: (Array.isArray(sprints) ? sprints : [])
        .map(obj)
        .map((s) => String(s.id ?? "")),
    };
  }

  /** Checks a created issue against the step; returns what did not match. */
  async verifyIssue(
    key: string,
    step: TrackerStep,
    parent: string | null,
    sprint: string | null,
  ) {
    const seen = await this.issue(key);
    const problems: string[] = [];
    if (seen.project !== step.project) throw Error("Jira identity mismatch");
    if (!seen.labels.includes(markerLabel(step.marker)))
      throw Error("Jira marker missing on read-back");
    if (parent && seen.parent !== parent)
      problems.push(`parent ${parent} not confirmed`);
    if (sprint && !seen.sprints.includes(sprint))
      problems.push(`sprint ${sprint} membership not confirmed`);
    return { seen, problems };
  }

  async createIssue(
    step: TrackerStep,
    parent: string | null,
    sprint: string | null,
  ): Promise<PlanReceipt> {
    if (parent !== null && !KEY.test(parent))
      throw new PlanRefused(
        `Jira refused it: ${parent} is not a Jira issue key`,
      );
    if (sprint !== null && !/^\d+$/.test(sprint))
      throw new PlanRefused(
        "Jira refused it: the sprint must be a Jira sprint number",
      );
    const { type, note } = this.chooseType(
      step,
      await this.issueTypes(step.project!),
    );
    const result = await this.call("createJiraIssue", {
      projectKey: step.project,
      summary: step.title,
      issueType: type,
      description: trackerBody(step),
      contentFormat: "markdown",
      labels: [markerLabel(step.marker)],
      ...(parent ? { parent } : {}),
      ...(sprint ? { assignToSprint: sprint } : {}),
    });
    if (result.isError)
      throw new PlanRefused(`Jira refused it: ${refusalText(result)}`);
    const key = text(payload(result).key);
    // Sent and answered without a key: uncertain, so look it up by marker.
    if (!key || !KEY.test(key))
      throw Error("Jira did not confirm the issue key");
    const { problems } = await this.verifyIssue(key, step, parent, sprint);
    return {
      externalId: key,
      url: this.url(key),
      ...(note || problems.length
        ? {
            note: [
              note,
              problems.length
                ? `Created as ${key}, but ${problems.join(" and ")}.`
                : "",
            ]
              .filter(Boolean)
              .join(" "),
          }
        : {}),
    };
  }

  /** The issue carrying this marker, or undefined when Jira confirms none. */
  async findIssue(
    step: TrackerStep,
    parent: string | null,
    sprint: string | null,
  ) {
    const keys = await settledSearch(async () => {
      const data = await this.read("searchJiraIssuesUsingJql", {
        jql: `project = "${step.project}" AND labels = "${markerLabel(step.marker)}"`,
        fields: ["summary"],
        maxResults: 10,
      });
      if (data.isLast === false) throw Error("Jira search incomplete");
      return (Array.isArray(data.issues) ? data.issues : [])
        .map(obj)
        .map((issue) => text(issue.key))
        .filter((key): key is string => !!key && KEY.test(key));
    }, this.wait);
    if (!keys.length) return undefined;
    const { key, note: duplicates } = earliest(keys);
    const { problems } = await this.verifyIssue(key, step, parent, sprint);
    return {
      externalId: key,
      url: this.url(key),
      note: `Found ${key} after an unconfirmed write; linked, not created again.${problems.length ? ` But ${problems.join(" and ")}.` : ""}${duplicates}`,
    } satisfies PlanReceipt;
  }

  async sprints(board: number) {
    const all: Record<string, unknown>[] = [];
    for (let startAt = 0; ;) {
      const result = await this.execute("executeRead", "listJiraBoardSprints", {
        boardId: board,
        state: "all",
        startAt,
        maxResults: 50,
      });
      if (result.isError) throw Error("Jira sprint list failed");
      const data = payload(result);
      const values = (Array.isArray(data.values) ? data.values : []).map(obj);
      all.push(...values);
      if (data.isLast !== false || !values.length) break;
      startAt += values.length;
      if (startAt > 2000) throw Error("Jira sprint list too long");
    }
    return all;
  }

  private sprintReceipt(
    sprint: Record<string, unknown>,
    step: TrackerStep,
    note?: string,
  ): PlanReceipt {
    const problems: string[] = [];
    if (step.startSprint && sprint.state !== "active")
      problems.push("it was not started");
    return {
      externalId: String(sprint.id),
      url: `https://${this.site.host}/jira/software/projects/${step.project}/boards/${step.board}`,
      ...(note || problems.length
        ? {
            note: [
              note,
              problems.length
                ? `Sprint ${String(sprint.id)} created, but ${problems.join(" and ")}.`
                : "",
            ]
              .filter(Boolean)
              .join(" "),
          }
        : {}),
    };
  }

  private async sprintByMarker(step: TrackerStep) {
    const line = markerLine(step.marker);
    const found = (await this.sprints(step.board!)).filter((s) =>
      String(s.goal ?? "").includes(line),
    );
    if (found.length > 1)
      throw Error("Jira has more than one sprint with this marker");
    return found[0];
  }

  /** Creates a future sprint on the board, then starts it when the plan says so. */
  async createSprint(step: TrackerStep): Promise<PlanReceipt> {
    const goal = [step.goal, markerLine(step.marker)]
      .filter(Boolean)
      .join("\n");
    const result = await this.execute(
      "executeDestructive",
      "manageJiraSprint",
      {
        action: "create",
        boardId: step.board,
        name: step.title,
        goal,
        ...(step.start ? { startDate: `${step.start}T09:00:00.000+0000` } : {}),
        ...(step.end ? { endDate: `${step.end}T18:00:00.000+0000` } : {}),
      },
    );
    if (result.isError)
      throw new PlanRefused(`Jira refused it: ${refusalText(result)}`);
    const id = text(payload(result).id);
    if (!id || !/^\d+$/.test(id))
      throw Error("Jira did not confirm the sprint id");
    return this.finishSprint(step, id);
  }

  /** Starts the sprint if asked, then reads it back from the board. */
  private async finishSprint(
    step: TrackerStep,
    id: string,
    note?: string,
  ): Promise<PlanReceipt> {
    let startNote: string | undefined;
    if (step.startSprint) {
      const current = (await this.sprints(step.board!)).find(
        (s) => String(s.id) === id,
      );
      if (current?.state === "future") {
        const started = await this.execute(
          "executeDestructive",
          "manageJiraSprint",
          {
            action: "start",
            sprintId: Number(id),
            startDate: `${step.start}T09:00:00.000+0000`,
            endDate: `${step.end}T18:00:00.000+0000`,
          },
        );
        if (started.isError)
          startNote = `Jira did not start it: ${refusalText(started)}`;
      }
    }
    const read = (await this.sprints(step.board!)).find(
      (s) => String(s.id) === id,
    );
    if (!read || !String(read.goal ?? "").includes(markerLine(step.marker)))
      throw Error("Jira sprint read-back failed");
    if (
      read.originBoardId !== undefined &&
      Number(read.originBoardId) !== step.board
    )
      throw Error("Jira identity mismatch");
    return this.sprintReceipt(
      read,
      step,
      [note, startNote].filter(Boolean).join(" ") || undefined,
    );
  }

  async findSprint(step: TrackerStep): Promise<PlanReceipt | undefined> {
    const found = await this.sprintByMarker(step);
    if (!found) return undefined;
    return this.finishSprint(
      step,
      String(found.id),
      `Found sprint ${String(found.id)} after an unconfirmed write; linked, not created again.`,
    );
  }
}

/** The Jira site the plan names, among those the grant reaches. */
export function jiraSite(
  sites: { id: string; url: string | null }[],
  host: string,
): JiraSite {
  const found = sites.find(
    (site) => site.url && new URL(site.url).host.toLowerCase() === host,
  );
  if (!found)
    throw new PlanRefused(
      `Jira refused it: this connection cannot reach ${host}. Reconnect Jira with an account on that site`,
    );
  return { cloudId: found.id, host };
}
