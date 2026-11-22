// Linear through its hosted MCP server (https://mcp.linear.app/mcp). Checked
// live on 22 November 2026: save_project (name, addTeams, description),
// save_issue (team, title, description, project, parentId, cycle), get_issue,
// get_project, list_issues (query searches title and description),
// list_projects, list_cycles and get_team. Linear's MCP server has no tool to
// create or start a cycle: Amun can only plan stories into an existing one.
import { PlanRefused, type PlanReceipt } from "../plan-publication.ts";
import {
  earliest,
  realWait,
  settledSearch,
  type Wait,
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

const ISSUE = /^[A-Z][A-Z0-9]{0,9}-\d+$/;
const PROJECT = /^P-[A-Z][A-Z0-9]{0,9}-\d+$/;

/** A Linear parent: an issue (TRA-1) or, for stories, a project (P-TRA-1). */
export type LinearParent = { issue: string } | { project: string } | null;

export class LinearWriter {
  constructor(
    private readonly session: TrackerSession,
    private readonly wait: Wait = realWait,
  ) {}

  private async call(name: string, args: Record<string, unknown>) {
    requireTool("linear", this.session, name);
    return this.session.call(name, args);
  }

  private async read(name: string, args: Record<string, unknown>) {
    const result = await this.call(name, args);
    if (result.isError) throw Error(`Linear read ${name} failed`);
    return obj(toolData(result));
  }

  /**
   * An issue's workflow state and cycle as Linear holds them now, for
   * read-back in Amun. Read only; the answer's shape varies, so missing parts
   * stay null.
   */
  async issueNow(id: string) {
    const seen = await this.read("get_issue", { id });
    const state = obj(seen.status ?? seen.state);
    return {
      id: text(seen.identifier) ?? id,
      title: text(seen.title),
      status: text(state.name) ?? text(seen.status) ?? text(seen.state),
      cycle:
        text(obj(seen.cycle).number) ??
        text(seen.cycleNumber) ??
        text(seen.cycleId),
      url: text(seen.url),
    };
  }

  /** The team the plan names; refused when this workspace has none. */
  async team(team: string) {
    const result = await this.call("get_team", { query: team });
    const found = result.isError ? {} : obj(toolData(result));
    const key = text(found.key);
    if (
      !key ||
      ![
        key.toLowerCase(),
        String(found.name ?? "").toLowerCase(),
        String(found.id ?? ""),
      ].includes(team.toLowerCase())
    )
      throw new PlanRefused(
        `Linear refused it: team ${team} is not in this workspace`,
      );
    return { id: String(found.id), key };
  }

  /** An existing cycle of the team, by number or id; never created. */
  async cycle(teamId: string, cycle: string) {
    const result = await this.call("list_cycles", { teamId });
    if (result.isError) throw Error("Linear read list_cycles failed");
    const data = toolData(result);
    const listed = Array.isArray(data) ? data : obj(data).cycles;
    const cycles = (Array.isArray(listed) ? listed : []).map(obj);
    const found = cycles.find(
      (c) => String(c.number ?? "") === cycle || String(c.id ?? "") === cycle,
    );
    if (!found)
      throw new PlanRefused(
        `Linear refused it: the team has no cycle ${cycle}. Linear's MCP server cannot create cycles; create it in Linear first`,
      );
    return { id: String(found.id), number: String(found.number ?? cycle) };
  }

  async createEpic(step: TrackerStep, teamKey: string): Promise<PlanReceipt> {
    if (step.epicAs === "issue")
      return this.createIssue(step, teamKey, null, null);
    const result = await this.call("save_project", {
      name: step.title,
      addTeams: [teamKey],
      description: trackerBody(step),
      ...(step.start ? { startDate: step.start } : {}),
      ...(step.end ? { targetDate: step.end } : {}),
    });
    if (result.isError)
      throw new PlanRefused(`Linear refused it: ${refusalText(result)}`);
    const id = text(obj(toolData(result)).id);
    if (!id || !PROJECT.test(id))
      throw Error("Linear did not confirm the project");
    return this.verifyProject(id, step, teamKey);
  }

  private async verifyProject(
    id: string,
    step: TrackerStep,
    teamKey: string,
    note?: string,
  ): Promise<PlanReceipt> {
    const seen = await this.read("get_project", { query: id });
    if (!String(seen.description ?? "").includes(markerLine(step.marker)))
      throw Error("Linear marker missing on read-back");
    const teams = (Array.isArray(seen.teams) ? seen.teams : []).map(obj);
    if (!teams.some((t) => t.key === teamKey))
      throw Error("Linear identity mismatch");
    return {
      externalId: id,
      ...(text(seen.url) ? { url: text(seen.url)! } : {}),
      ...(note ? { note } : {}),
    };
  }

  async createIssue(
    step: TrackerStep,
    teamKey: string,
    parent: LinearParent,
    cycle: { id: string; number: string } | null,
  ): Promise<PlanReceipt> {
    const result = await this.call("save_issue", {
      team: teamKey,
      title: step.title,
      description: trackerBody(step),
      ...(parent && "issue" in parent ? { parentId: parent.issue } : {}),
      ...(parent && "project" in parent ? { project: parent.project } : {}),
      ...(cycle ? { cycle: cycle.id } : {}),
    });
    if (result.isError)
      throw new PlanRefused(`Linear refused it: ${refusalText(result)}`);
    const id = text(obj(toolData(result)).id);
    if (!id || !ISSUE.test(id)) throw Error("Linear did not confirm the issue");
    return this.verifyIssue(id, step, teamKey, parent, cycle);
  }

  /** Reads the issue back: marker, team, parent and cycle. */
  private async verifyIssue(
    id: string,
    step: TrackerStep,
    teamKey: string,
    parent: LinearParent,
    cycle: { id: string; number: string } | null,
    note?: string,
  ): Promise<PlanReceipt> {
    const seen = await this.read("get_issue", {
      id,
      fields: [
        "id",
        "description",
        "url",
        "parentId",
        "projectId",
        "cycleId",
        "teamId",
      ],
    });
    if (!String(seen.description ?? "").includes(markerLine(step.marker)))
      throw Error("Linear marker missing on read-back");
    if (!id.startsWith(teamKey + "-")) throw Error("Linear identity mismatch");
    const problems: string[] = [];
    if (parent && "issue" in parent) {
      const got = text(seen.parentId);
      if (got !== parent.issue)
        problems.push(`parent ${parent.issue} not confirmed`);
    }
    if (parent && "project" in parent) {
      const got = text(seen.projectId);
      const project = got
        ? await this.read("get_project", { query: parent.project })
        : {};
      if (!got || String(project.uuid ?? "") !== got)
        problems.push(`project ${parent.project} not confirmed`);
    }
    if (cycle) {
      const got = text(seen.cycleId);
      if (got !== cycle.id && got !== cycle.number)
        problems.push(`cycle ${cycle.number} membership not confirmed`);
    }
    const all = [
      note,
      problems.length ? `Created as ${id}, but ${problems.join(" and ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return {
      externalId: id,
      ...(text(seen.url) ? { url: text(seen.url)! } : {}),
      ...(all ? { note: all } : {}),
    };
  }

  /** The item carrying this marker, or undefined when Linear confirms none. */
  async find(
    step: TrackerStep,
    teamKey: string,
    parent: LinearParent,
    cycle: { id: string; number: string } | null,
  ): Promise<PlanReceipt | undefined> {
    const line = markerLine(step.marker);
    const linked = (what: string) =>
      `Found ${what} after an unconfirmed write; linked, not created again.`;
    const project = step.kind === "epic" && step.epicAs === "project";
    const ids = await settledSearch(async () => {
      const listed = project
        ? await this.read("list_projects", {
            query: step.title,
            team: teamKey,
            limit: 50,
            includeArchived: true,
          })
        : await this.read("list_issues", {
            query: step.marker,
            team: teamKey,
            limit: 50,
            includeArchived: true,
          });
      if (listed.hasNextPage === true) throw Error("Linear search incomplete");
      const rows = project ? listed.projects : listed.issues;
      return (Array.isArray(rows) ? rows : [])
        .map(obj)
        .filter((row) => String(row.description ?? "").includes(line))
        .map((row) => text(row.id))
        .filter(
          (id): id is string => !!id && (project ? PROJECT : ISSUE).test(id),
        );
    }, this.wait);
    if (!ids.length) return undefined;
    const { key: id, note: duplicates } = earliest(ids);
    return project
      ? this.verifyProject(id, step, teamKey, linked(id) + duplicates)
      : this.verifyIssue(
          id,
          step,
          teamKey,
          parent,
          cycle,
          linked(id) + duplicates,
        );
  }
}

/** A parent value: an Amun receipt or an existing key. */
export function linearParent(value: string | null): LinearParent {
  if (!value) return null;
  if (PROJECT.test(value)) return { project: value };
  if (ISSUE.test(value)) return { issue: value };
  throw new PlanRefused(
    `Linear refused it: ${value} is not a Linear issue or project`,
  );
}
