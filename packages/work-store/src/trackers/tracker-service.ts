// Linear and Jira in the daemon: the hosted-MCP connections (sign-in, check,
// disconnect), publishing of plans the captain approved for either, recovery
// of writes left uncertain by a crash, and a read-only view of the places a
// plan can name (sites, projects, boards, sprints, teams, cycles).
//
// Nothing here approves anything. A plan is written only after the captain's
// approve-plan, which binds the exact items (and so their site, project or
// team, board, parent and sprint) to the fingerprint they saw.
import type { Database } from "../sqlite.ts";
import { PlanPublisher } from "../plan-publication.ts";
import {
  TrackerHost,
  TRACKERS,
  type TrackerHostOptions,
  type TrackerId,
  type TrackerStatus,
} from "../../../notion/src/tracker-host.ts";
import { trackerResolver } from "./tracker-target.ts";
import {
  obj,
  text,
  toolData,
  type TrackerSession,
  type Wait,
} from "./tracker-items.ts";

export interface TrackerRecords {
  handle(input: unknown): unknown[];
}

const isTracker = (value: unknown): value is TrackerId =>
  value === "linear" || value === "jira";

type Message = {
  action?: unknown;
  provider?: unknown;
  planId?: unknown;
  retry?: unknown;
};

export class TrackerService {
  readonly host: Pick<
    TrackerHost,
    "status" | "connect" | "disconnect" | "cancel" | "use" | "stop"
  >;
  private readonly publisher: PlanPublisher;

  constructor(
    private readonly db: Database,
    records: TrackerRecords,
    options: TrackerHostOptions & {
      host?: TrackerService["host"];
      wait?: Wait;
    },
  ) {
    this.host = options.host ?? new TrackerHost(options);
    this.publisher = new PlanPublisher(
      db,
      records,
      trackerResolver(
        db,
        {
          configured: async (provider) =>
            (await this.host.status(provider)).status !== "missing",
          use: (provider, work) => this.host.use(provider, work),
        },
        options.wait,
      ),
    );
  }

  private destination(planId: string) {
    const row = this.db
      .prepare("SELECT destination FROM work_plans WHERE id=?")
      .get(planId) as { destination: string } | undefined;
    return row?.destination;
  }

  /** True when the plan goes to Linear or Jira. */
  owns(planId: string) {
    return isTracker(this.destination(planId));
  }

  /**
   * Publishes a Linear or Jira plan the captain approved. Returns the work
   * store's events (the updated snapshot), or [] for any other plan.
   */
  publish(planId: string, retry = false) {
    if (!this.owns(planId)) return Promise.resolve([] as unknown[]);
    if (retry && this.publisher.needsReview(planId))
      return Promise.resolve([] as unknown[]);
    return this.publisher.publish(planId, { retryFailed: retry });
  }

  /** After a restart: looks up writes that were sent and never confirmed. */
  async recover() {
    const events: unknown[] = [];
    for (const planId of this.publisher.uncertain())
      if (this.owns(planId))
        events.push(
          ...(await this.publisher.publish(planId, { reconcileOnly: true })),
        );
    return events;
  }

  /** What was written for a plan (state, key, link, note) per item. */
  writes(planId: string) {
    return this.publisher.writes(planId);
  }

  /** Renderer and RPC messages: status, connect, check, disconnect, cancel, publish. */
  async handle(message: unknown): Promise<Record<string, unknown>> {
    const m = obj(message) as Message;
    const action = String(m.action ?? "");
    if (action === "publish") {
      const planId = String(m.planId ?? "");
      if (!this.owns(planId))
        return { kind: "tracker-publish", planId, handled: false };
      const events = await this.publish(planId, m.retry === true);
      return {
        kind: "tracker-publish",
        planId,
        handled: true,
        events,
        writes: this.writes(planId),
      };
    }
    if (action === "list")
      return {
        kind: "tracker-status",
        trackers: await Promise.all(TRACKERS.map((p) => this.host.status(p))),
      };
    if (!isTracker(m.provider)) throw Error("Choose Linear or Jira");
    const provider = m.provider;
    let status: TrackerStatus;
    switch (action) {
      case "status":
        status = await this.host.status(provider);
        break;
      case "connect":
      case "check":
        status = await this.host.connect(provider, action === "connect");
        break;
      case "disconnect":
        status = await this.host.disconnect(provider);
        break;
      case "cancel":
        this.host.cancel(provider);
        status = await this.host.status(provider);
        break;
      case "targets":
        return {
          kind: "tracker-targets",
          provider,
          text: await this.targets(provider),
        };
      default:
        throw Error("Unknown tracker action");
    }
    return { kind: "tracker-status", ...status };
  }

  /**
   * The places a plan can name, as plain text for the First Mate: read only,
   * and nothing about the grant itself.
   */
  async targets(provider: TrackerId): Promise<string> {
    return this.host.use(provider, (session) =>
      provider === "jira" ? jiraTargets(session) : linearTargets(session),
    );
  }

  stop() {
    this.host.stop();
  }
}

const list = (value: unknown) => (Array.isArray(value) ? value.map(obj) : []);
/** Jira's MCP server nests its answer under `data`. */
const nested = (value: unknown) => {
  const data = obj(value);
  return "data" in data ? obj(data.data) : data;
};

async function read(
  session: TrackerSession,
  name: string,
  args: Record<string, unknown>,
) {
  if (!session.tools.some((tool) => tool.name === name)) return {};
  const result = await session.call(name, args);
  return result.isError ? {} : toolData(result);
}

async function jiraTargets(session: TrackerSession) {
  const lines: string[] = [];
  const sites = list(
    obj(obj(await read(session, "getAccessibleAtlassianResources", {})).data)
      .resources,
  );
  for (const site of sites.slice(0, 5)) {
    const cloudId = text(site.cloudId);
    const host = text(site.url)?.replace(/^https:\/\//, "") ?? "";
    if (!cloudId) continue;
    lines.push(`Site: ${host}`);
    const projects = list(
      nested(
        await read(session, "executeRead", {
          cloudId,
          name: "listJiraProjects",
          inputs: { expand: "issueTypes", action: "create" },
        }),
      ).values,
    ).filter((p) => p.projectTypeKey === "software");
    for (const p of projects.slice(0, 30))
      lines.push(
        `  Project ${text(p.key)} (${text(p.name)}): types ${list(p.issueTypes)
          .filter((t) => t.subtask !== true)
          .map((t) => text(t.name))
          .join(", ")}`,
      );
    const boards = list(
      nested(
        await read(session, "executeRead", {
          cloudId,
          name: "listJiraBoards",
          inputs: {},
        }),
      ).values,
    );
    for (const b of boards.slice(0, 20)) {
      lines.push(
        `  Board ${text(b.id)} (${text(b.name)}) for project ${text(obj(b.location).projectKey) ?? "?"}`,
      );
      const sprints = list(
        nested(
          await read(session, "executeRead", {
            cloudId,
            name: "listJiraBoardSprints",
            inputs: { boardId: Number(b.id), state: "all" },
          }),
        ).values,
      ).filter((s) => s.state !== "closed");
      for (const s of sprints.slice(0, 20))
        lines.push(
          `    Sprint ${text(s.id)} "${text(s.name)}" ${text(s.state)}${s.startDate ? ` ${String(s.startDate).slice(0, 10)} to ${String(s.endDate ?? "").slice(0, 10)}` : ""}`,
        );
    }
  }
  return lines.join("\n") || "No Jira site this connection can write to.";
}

async function linearTargets(session: TrackerSession) {
  const workspace = obj(await read(session, "get_workspace", {}));
  const lines = [
    `Workspace: ${(text(workspace.url) ?? "").replace(/^https:\/\/linear\.app\//, "")} (${text(workspace.name) ?? ""})`,
  ];
  const teams = list(obj(await read(session, "list_teams", {})).teams);
  for (const t of teams.slice(0, 30)) {
    lines.push(`  Team ${text(t.key)} (${text(t.name)})`);
    const data = await read(session, "list_cycles", {
      teamId: text(t.id) ?? text(t.key) ?? "",
    });
    const cycles = list(Array.isArray(data) ? data : obj(data).cycles);
    lines.push(
      cycles.length
        ? cycles
            .slice(0, 10)
            .map(
              (c) =>
                `    Cycle ${text(c.number)} ${String(c.startsAt ?? "").slice(0, 10)} to ${String(c.endsAt ?? "").slice(0, 10)}`,
            )
            .join("\n")
        : "    No cycles (cycles are off for this team, or none exist yet)",
    );
  }
  const projects = list(
    obj(await read(session, "list_projects", { limit: 50 })).projects,
  );
  for (const p of projects.slice(0, 30))
    lines.push(`  Project ${text(p.id)} (${text(p.name)})`);
  return lines.join("\n");
}
