import type { AzureProcessSchema } from "../../contracts/src/backlog.ts";
import { azurePathSegment } from "./ado-path.ts";
import type { Transport } from "./ado-client.ts";

type BoardSummary = { id: string; name: string };
type SprintItem = {
  assignedIdentity?: { id: string; uniqueName: string };
  labels?: string[];
  points?: number;
  indicator?: { rev: number; blocked: boolean };
  id: number;
  title: string;
  type: string;
  state: string;
  assignee: string | null;
};

type BoardColumn = BoardSummary & {
  isSplit: boolean;
  stateMappings: Record<string, string>;
};
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function summary(item: unknown): BoardSummary {
  if (
    !record(item) ||
    typeof item.id !== "string" ||
    typeof item.name !== "string"
  )
    throw new Error("Invalid Azure board");
  return { id: item.id, name: item.name };
}
/** Cached per connection and team. Only complete responses enter the cache. */
export class BoardDiscovery {
  private schema?: { expires: number; value: AzureProcessSchema };
  private readonly base: URL;
  private readonly cache = new Map<
    string,
    { expires: number; values: unknown[] }
  >();
  private readonly types = new Map<
    string,
    { expires: number; value: { story?: string; task?: string } }
  >();
  private readonly project: string;
  private readonly transport: Transport;

  constructor(collection: string, project: string, transport: Transport) {
    this.base = new URL(collection);
    if (
      this.base.protocol !== "https:" ||
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash
    )
      throw new Error("Invalid Azure scope");
    if (!this.base.pathname.endsWith("/")) this.base.pathname += "/";
    this.project = azurePathSegment(project);
    this.transport = transport;
  }

  async processSchema(refresh = false): Promise<AzureProcessSchema> {
    if (!refresh && this.schema && this.schema.expires > Date.now())
      return structuredClone(this.schema.value);
    const wit = this.project + "/_apis/wit/";
    const classification = async (group: string) => {
      const root = await this.get(
        new URL(wit + "classificationnodes/" + group + "?$depth=14", this.base),
      );
      const paths: string[] = [];
      function walk(node: unknown, parent: string) {
        if (!record(node) || typeof node.name !== "string")
          throw Error("Invalid Azure classification");
        const path = parent ? parent + "\\" + node.name : node.name;
        paths.push(path);
        if (node.hasChildren && !Array.isArray(node.children))
          throw Error("Incomplete Azure classification");
        if (Array.isArray(node.children))
          for (const child of node.children) walk(child, path);
      }
      walk(root, "");
      return paths;
    };
    const [project, types, areas, iterations] = await Promise.all([
      this.get(
        new URL(
          "_apis/projects/" + this.project + "?includeCapabilities=true",
          this.base,
        ),
      ),
      this.list(wit + "workitemtypes", refresh),
      classification("areas"),
      classification("iterations"),
    ]);
    if (!record(project)) throw Error("Invalid Azure project");
    const template = record(project.capabilities)
      ? project.capabilities.processTemplate
      : null;
    const value: AzureProcessSchema = {
      process:
        record(template) && typeof template.templateName === "string"
          ? template.templateName
          : null,
      types: [],
      areas,
      iterations,
    };
    for (const type of types) {
      if (!record(type) || typeof type.name !== "string")
        throw Error("Invalid Azure type");
      const path = wit + "workitemtypes/" + azurePathSegment(type.name);
      const [fields, states] = await Promise.all([
        this.list(path + "/fields?$expand=All", refresh),
        this.list(path + "/states", refresh),
      ]);
      value.types.push({
        name: type.name,
        states: states.map((state) => {
          if (!record(state) || typeof state.name !== "string")
            throw Error("Invalid Azure state");
          return state.name;
        }),
        fields: fields.map((field) => {
          if (
            !record(field) ||
            typeof field.referenceName !== "string" ||
            typeof field.name !== "string"
          )
            throw Error("Invalid Azure field");
          const def = field.defaultValue;
          return {
            name: field.name,
            referenceName: field.referenceName,
            required: field.alwaysRequired === true,
            allowedValues: Array.isArray(field.allowedValues)
              ? field.allowedValues.filter(
                  (x): x is string => typeof x === "string",
                )
              : [],
            defaultValue:
              typeof def === "string" ||
              typeof def === "number" ||
              typeof def === "boolean"
                ? def
                : null,
          };
        }),
      });
    }
    this.schema = { expires: Date.now() + 60000, value };
    return structuredClone(value);
  }
  async boards(team: string, refresh = false): Promise<BoardSummary[]> {
    const path =
      this.project + "/" + azurePathSegment(team) + "/_apis/work/boards";
    return (await this.list(path, refresh)).map(summary);
  }

  async columns(
    team: string,
    board: string,
    refresh = false,
  ): Promise<BoardColumn[]> {
    const path =
      this.project +
      "/" +
      azurePathSegment(team) +
      "/_apis/work/boards/" +
      azurePathSegment(board) +
      "/columns";
    return (await this.list(path, refresh)).map((item) => {
      if (!record(item) || !record(item.stateMappings))
        throw new Error("Invalid Azure column mappings");
      const stateMappings: Record<string, string> = Object.create(null);
      for (const [type, state] of Object.entries(item.stateMappings)) {
        if (typeof state !== "string")
          throw new Error("Invalid Azure work item state");
        stateMappings[type] = state;
      }
      return {
        ...summary(item),
        isSplit: item.isSplit === true,
        stateMappings,
      };
    });
  }
  async teams(refresh = false) {
    return (
      await this.list("_apis/projects/" + this.project + "/teams", refresh, 100)
    ).map(summary);
  }

  async iterations(team: string) {
    return (
      await this.list(
        this.project +
          "/" +
          azurePathSegment(team) +
          "/_apis/work/teamsettings/iterations",
        true,
      )
    ).map((x) => {
      if (!record(x) || typeof x.path !== "string")
        throw Error("Invalid team iteration");
      return x.path;
    });
  }
  /** Read-only: the team's iterations, including completed and undated ones. */
  async sprints(team: string, limit?: number) {
    const found: {
      id: string;
      name: string;
      path: string;
      start: string;
      finish: string;
    }[] = [];
    const values = await this.list(
      this.project +
        "/" +
        azurePathSegment(team) +
        "/_apis/work/teamsettings/iterations",
      true,
    );
    for (const x of values) {
      if (
        !record(x) ||
        typeof x.id !== "string" ||
        typeof x.name !== "string" ||
        typeof x.path !== "string"
      )
        throw Error("Invalid team iteration");
      const a = record(x.attributes) ? x.attributes : {};
      found.push({
        id: x.id,
        name: x.name,
        path: x.path,
        start: typeof a.startDate === "string" ? a.startDate : "",
        finish: typeof a.finishDate === "string" ? a.finishDate : "",
      });
    }
    return found.sort((a, b) => a.start.localeCompare(b.start)).slice(0, limit);
  }
  /**
   * The project's own types for stories and for their tasks, from the team's
   * read-only backlog configuration. Cached per team.
   */
  async backlogTypes(team?: string) {
    const key = team ?? "";
    const hit = this.types.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    let name = team;
    if (!name) {
      const project = await this.get(
        new URL(
          "_apis/projects/" + this.project + "?includeCapabilities=true",
          this.base,
        ),
      );
      name =
        record(project) &&
        record(project.defaultTeam) &&
        typeof project.defaultTeam.name === "string"
          ? project.defaultTeam.name
          : undefined;
    }
    if (!name) return {};
    const data = await this.get(
      new URL(
        this.project +
          "/" +
          azurePathSegment(name) +
          "/_apis/work/backlogconfiguration",
        this.base,
      ),
    );
    const first = (level: unknown) => {
      if (!record(level)) return undefined;
      const fallback = record(level.defaultWorkItemType)
        ? level.defaultWorkItemType.name
        : undefined;
      if (typeof fallback === "string") return fallback;
      const names = Array.isArray(level.workItemTypes)
        ? level.workItemTypes
        : [];
      const one = names.find(
        (type) => record(type) && typeof type.name === "string",
      );
      return record(one) ? (one.name as string) : undefined;
    };
    const value: { story?: string; task?: string } = {};
    if (record(data)) {
      const story = first(data.requirementBacklog);
      const task = first(data.taskBacklog);
      if (story) value.story = story;
      if (task) value.task = task;
    }
    this.types.set(key, { expires: Date.now() + 600000, value });
    return value;
  }
  async levels(team: string, refresh = false) {
    return (
      await this.list(
        this.project + "/" + azurePathSegment(team) + "/_apis/work/backlogs",
        refresh,
      )
    ).map(summary);
  }

  async transitions(type: string) {
    const data = await this.get(
      new URL(
        this.project + "/_apis/wit/workitemtypes/" + azurePathSegment(type),
        this.base,
      ),
    );
    if (!record(data) || !record(data.transitions) || data.isDisabled === true)
      return {};
    const result: Record<string, string[]> = Object.create(null);
    for (const [from, options] of Object.entries(data.transitions)) {
      if (Array.isArray(options))
        result[from] = options.flatMap((s) =>
          record(s) && typeof s.to === "string" && s.to !== from ? [s.to] : [],
        );
    }
    return result;
  }
  async teamIdentities(team: string) {
    // This endpoint pages by skip and top and nests each user under identity.
    const members: { id: string; name: string; uniqueName: string }[] = [];
    const seen = new Set<string>();
    for (let skip = 0; ; skip += 100) {
      const url = new URL(
        "_apis/projects/" +
          this.project +
          "/teams/" +
          azurePathSegment(team) +
          "/members",
        this.base,
      );
      url.searchParams.set("$top", "100");
      url.searchParams.set("$skip", String(skip));
      const data = await this.get(url);
      if (!record(data) || !Array.isArray(data.value))
        throw Error("Team member discovery is incomplete.");
      for (const member of data.value) {
        const identity = record(member) && member.identity;
        if (
          !record(identity) ||
          typeof identity.id !== "string" ||
          seen.has(identity.id)
        )
          throw Error("Team member discovery is incomplete.");
        seen.add(identity.id);
        if (
          typeof identity.uniqueName === "string" &&
          typeof identity.displayName === "string" &&
          identity.isContainer !== true
        )
          members.push({
            id: identity.id,
            name: identity.displayName,
            uniqueName: identity.uniqueName,
          });
      }
      if (data.value.length < 100) return members;
    }
  }
  async storyComments(id: number) {
    if (!Number.isSafeInteger(id) || id < 1) throw Error("Invalid story ID");
    const url = new URL(
      this.project + "/_apis/wit/workItems/" + id + "/comments",
      this.base,
    );
    url.searchParams.set("api-version", "7.0-preview.3");
    url.searchParams.set("$top", "200");
    const comments: {
      id: number;
      version: number;
      authorId: string;
      at: string;
      text: string;
      url: string;
    }[] = [];
    const seen = new Set<string>();
    for (;;) {
      const page = await this.transport("GET", url.href);
      if (
        page.status !== 200 ||
        !record(page.data) ||
        !Array.isArray(page.data.comments)
      )
        throw Error("Azure comments unavailable.");
      for (const c of page.data.comments) {
        if (c.isDeleted) continue;
        if (
          c.workItemId !== id ||
          !Number.isSafeInteger(c.id) ||
          !Number.isSafeInteger(c.version) ||
          !c.createdBy?.id ||
          typeof c.text !== "string" ||
          !Number.isFinite(Date.parse(c.createdDate))
        )
          throw Error("Azure comment evidence incomplete.");
        const link = new URL(
          this.project + "/_workitems/edit/" + id,
          this.base,
        );
        link.searchParams.set("discussionId", String(c.id));
        comments.push({
          id: c.id,
          version: c.version,
          authorId: c.createdBy.id,
          at: c.createdDate,
          text: c.text,
          url: link.href,
        });
      }
      const next = page.continuationToken ?? page.data.continuationToken;
      if (!next) return comments;
      if (typeof next !== "string" || seen.has(next))
        throw Error("Azure comment pagination incomplete.");
      seen.add(next);
      url.searchParams.set("continuationToken", next);
    }
  }

  async planningCreationTarget(
    team: string,
    levelId: string,
    backlogIteration: string | null,
  ) {
    if (!backlogIteration) return null;
    const prefix = this.project + "/" + azurePathSegment(team) + "/_apis/work/";
    const [config, areas] = await Promise.all([
      this.get(new URL(prefix + "backlogconfiguration", this.base)),
      this.get(new URL(prefix + "teamsettings/teamfieldvalues", this.base)),
    ]);
    if (
      !record(config) ||
      !record(config.requirementBacklog) ||
      config.requirementBacklog.id !== levelId ||
      !record(config.requirementBacklog.defaultWorkItemType) ||
      typeof config.requirementBacklog.defaultWorkItemType.name !== "string" ||
      !record(areas) ||
      !record(areas.field) ||
      areas.field.referenceName !== "System.AreaPath" ||
      typeof areas.defaultValue !== "string" ||
      !Array.isArray(areas.values) ||
      !areas.values.some((v) => record(v) && v.value === areas.defaultValue)
    )
      return null;
    return {
      type: config.requirementBacklog.defaultWorkItemType.name,
      area: areas.defaultValue,
      backlogIteration,
    };
  }
  async backlogIteration(team: string): Promise<string | null> {
    const settings = await this.get(
      new URL(
        this.project +
          "/" +
          azurePathSegment(team) +
          "/_apis/work/teamsettings",
        this.base,
      ),
    );
    if (!record(settings) || !record(settings.backlogIteration)) return null;
    const path = settings.backlogIteration.path;
    return typeof path === "string" && path.trim() ? path : null;
  }
  async boardSettings(team: string, board: string) {
    const url = new URL(
      this.project +
        "/" +
        azurePathSegment(team) +
        "/_apis/work/boards/" +
        azurePathSegment(board),
      this.base,
    );
    const data = await this.get(url);
    if (
      !record(data) ||
      !record(data.fields) ||
      !record(data.fields.columnField) ||
      typeof data.fields.columnField.referenceName !== "string"
    )
      throw new Error("Invalid Azure board fields");
    return {
      columnField: data.fields.columnField.referenceName,
      canEdit: data.canEdit === true,
    };
  }

  /**
   * Read-only: the work items in one of the team's sprints, as Azure lists
   * them, with title, type, state and who they are assigned to.
   */
  async iterationItems(team: string, iteration: string, limit?: number) {
    const data = await this.get(
      new URL(
        this.project +
          "/" +
          azurePathSegment(team) +
          "/_apis/work/teamsettings/iterations/" +
          azurePathSegment(iteration) +
          "/workitems",
        this.base,
      ),
    );
    if (!record(data) || !Array.isArray(data.workItemRelations))
      throw new Error("Invalid Azure sprint");
    const ids = new Set<number>();
    for (const relation of data.workItemRelations) {
      const id = relation?.target?.id;
      if (!Number.isSafeInteger(id) || id < 1)
        throw new Error("Invalid Azure item reference");
      ids.add(id);
    }
    const wanted = [...ids].slice(0, limit);
    const byId = new Map<number, SprintItem>();
    const ranks = new Map<number, number>();
    for (let offset = 0; offset < wanted.length; offset += 200) {
      const url = new URL(this.project + "/_apis/wit/workitems", this.base);
      const chunk = new Set(wanted.slice(offset, offset + 200));
      url.searchParams.set("ids", [...chunk].join(","));
      const batch = await this.get(url);
      if (!record(batch) || !Array.isArray(batch.value))
        throw new Error("Invalid Azure items");
      for (const item of batch.value) {
        const f = item?.fields;
        if (
          !f ||
          !chunk.has(item.id) ||
          byId.has(item.id) ||
          typeof f["System.Title"] !== "string" ||
          typeof f["System.State"] !== "string" ||
          typeof f["System.WorkItemType"] !== "string"
        )
          throw new Error("Invalid Azure item");
        const rank =
          f["Microsoft.VSTS.Common.StackRank"] ??
          f["Microsoft.VSTS.Common.BacklogPriority"];
        if (typeof rank === "number" && Number.isFinite(rank))
          ranks.set(item.id, rank);
        const who = f["System.AssignedTo"];
        const points = f["Microsoft.VSTS.Scheduling.StoryPoints"];
        const indicator = f["Microsoft.VSTS.CMMI.Blocked"];
        byId.set(item.id, {
          ...(typeof f["System.Tags"] === "string"
            ? {
                labels: f["System.Tags"]
                  .split(";")
                  .map((label: string) => label.trim())
                  .filter(Boolean),
              }
            : {}),
          ...(typeof points === "number" && Number.isFinite(points)
            ? { points }
            : {}),
          ...(Number.isSafeInteger(item.rev) &&
          item.rev > 0 &&
          (indicator === "Yes" || indicator === "No")
            ? { indicator: { rev: item.rev, blocked: indicator === "Yes" } }
            : {}),
          ...(record(who) &&
          typeof who.id === "string" &&
          typeof who.uniqueName === "string"
            ? { assignedIdentity: { id: who.id, uniqueName: who.uniqueName } }
            : {}),
          id: item.id,
          title: f["System.Title"],
          type: f["System.WorkItemType"],
          state: f["System.State"],
          assignee:
            typeof who === "string"
              ? who
              : record(who) && typeof who.displayName === "string"
                ? who.displayName
                : null,
        });
      }
    }
    if (byId.size !== wanted.length) throw new Error("Incomplete Azure sprint");
    if (ranks.size === wanted.length)
      wanted.sort((a, b) => ranks.get(a)! - ranks.get(b)!);
    return {
      items: wanted.map((id) => byId.get(id)!),
      more: ids.size > wanted.length,
    };
  }

  private async get(url: URL) {
    url.searchParams.set("api-version", "7.0");
    const response = await this.transport("GET", url.href);
    if (response.status < 200 || response.status >= 300)
      throw new Error("request_rejected_" + response.status);
    return response.data;
  }

  async cards(
    team: string,
    level: string,
    columnField: string,
    details = false,
  ) {
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,255}$/.test(columnField))
      throw new Error("Invalid Azure column field");
    const data = await this.get(
      new URL(
        this.project +
          "/" +
          azurePathSegment(team) +
          "/_apis/work/backlogs/" +
          azurePathSegment(level) +
          "/workItems",
        this.base,
      ),
    );
    if (!record(data) || !Array.isArray(data.workItems))
      throw new Error("Invalid Azure backlog");
    const ids = new Set<number>();
    for (const relation of data.workItems) {
      const id = relation?.target?.id;
      if (!Number.isSafeInteger(id) || id < 1)
        throw new Error("Invalid Azure item reference");
      ids.add(id);
    }
    const ordered = [...ids];
    const byId = new Map<
      number,
      {
        id: number;
        rev: number;
        title: string;
        type: string;
        state: string;
        column: string | null;
        iteration: string | null;
        assignee?: string;
        assigneeId?: string;
        labels?: string[];
        estimates?: { name: string; value: number }[];
        blocked?: string | undefined;
        description?: string;
        criteria?: string;
        rank?: {
          field:
            | "Microsoft.VSTS.Common.StackRank"
            | "Microsoft.VSTS.Common.BacklogPriority";
          value: number;
        };
        prerequisites?: number[];
      }
    >();
    for (let offset = 0; offset < ordered.length; offset += 200) {
      const url = new URL(this.project + "/_apis/wit/workitems", this.base);
      url.searchParams.set(
        "ids",
        ordered.slice(offset, offset + 200).join(","),
      );
      if (details) url.searchParams.set("$expand", "Relations");
      if (!details)
        url.searchParams.set(
          "fields",
          [
            "System.Title",
            "System.State",
            "System.WorkItemType",
            "System.IterationPath",
            columnField,
          ].join(","),
        );
      const batch = await this.get(url);
      if (!record(batch) || !Array.isArray(batch.value))
        throw new Error("Invalid Azure items");
      for (const item of batch.value) {
        const f = item?.fields;
        if (
          !f ||
          !Number.isSafeInteger(item.rev) ||
          item.rev < 1 ||
          !ids.has(item.id) ||
          byId.has(item.id) ||
          typeof f["System.Title"] !== "string" ||
          typeof f["System.State"] !== "string" ||
          typeof f["System.WorkItemType"] !== "string"
        )
          throw new Error("Invalid Azure item");
        const rankField = (
          [
            "Microsoft.VSTS.Common.StackRank",
            "Microsoft.VSTS.Common.BacklogPriority",
          ] as const
        ).find(
          (field) => typeof f[field] === "number" && Number.isFinite(f[field]),
        );
        byId.set(item.id, {
          ...(details && rankField
            ? { rank: { field: rankField, value: f[rankField] } }
            : {}),
          id: item.id,
          rev: item.rev,
          title: f["System.Title"],
          state: f["System.State"],
          type: f["System.WorkItemType"],
          iteration:
            typeof f["System.IterationPath"] === "string"
              ? f["System.IterationPath"]
              : null,
          ...(details
            ? {
                prerequisites: Array.isArray(item.relations)
                  ? item.relations.flatMap((rel: unknown) => {
                      if (
                        !record(rel) ||
                        rel.rel !== "System.LinkTypes.Dependency-Reverse" ||
                        typeof rel.url !== "string"
                      )
                        return [];
                      try {
                        const target = new URL(rel.url);
                        const match = target.pathname.match(
                          /\/_apis\/wit\/workitems\/(\d+)$/i,
                        );
                        const id = match && Number(match[1]);
                        if (
                          target.origin === this.base.origin &&
                          target.pathname
                            .toLowerCase()
                            .startsWith(this.base.pathname.toLowerCase()) &&
                          id &&
                          ids.has(id)
                        )
                          return [id];
                      } catch {}
                      return [];
                    })
                  : [],
                ...(typeof f["System.AssignedTo"]?.id === "string"
                  ? { assigneeId: f["System.AssignedTo"].id }
                  : {}),
                assignee:
                  typeof f["System.AssignedTo"] === "string"
                    ? f["System.AssignedTo"]
                    : f["System.AssignedTo"]?.displayName,
                labels:
                  typeof f["System.Tags"] === "string"
                    ? f["System.Tags"]
                        .split(";")
                        .map((t: string) => t.trim())
                        .filter(Boolean)
                    : [],
                estimates: ["StoryPoints", "Effort", "Size"].flatMap(
                  (field) => {
                    const value = f["Microsoft.VSTS.Scheduling." + field];
                    return typeof value === "number"
                      ? [
                          {
                            name:
                              field === "StoryPoints" ? "Story points" : field,
                            value,
                          },
                        ]
                      : [];
                  },
                ),
                blocked:
                  typeof f["Microsoft.VSTS.CMMI.Blocked"] === "string"
                    ? f["Microsoft.VSTS.CMMI.Blocked"]
                    : undefined,
                description:
                  typeof f["System.Description"] === "string"
                    ? f["System.Description"]
                    : "",
                criteria:
                  typeof f["Microsoft.VSTS.Common.AcceptanceCriteria"] ===
                  "string"
                    ? f["Microsoft.VSTS.Common.AcceptanceCriteria"]
                    : "",
              }
            : {}),
          column: typeof f[columnField] === "string" ? f[columnField] : null,
        });
      }
    }
    if (byId.size !== ids.size) throw new Error("Incomplete Azure backlog");
    return ordered.map((id) => byId.get(id)!);
  }

  private async list(
    path: string,
    refresh: boolean,
    pageSize?: number,
  ): Promise<unknown[]> {
    const cached = this.cache.get(path);
    if (!refresh && cached && cached.expires > Date.now()) return cached.values;
    const url = new URL(path, this.base);
    url.searchParams.set("api-version", "7.0");
    if (pageSize) url.searchParams.set("$top", String(pageSize));
    const values: unknown[] = [];
    const seen = new Set<string>();
    for (;;) {
      const { status, data, continuationToken } = await this.transport(
        "GET",
        url.href,
      );
      if (status < 200 || status >= 300)
        throw new Error("request_rejected_" + status);
      if (
        !data ||
        typeof data !== "object" ||
        !("value" in data) ||
        !Array.isArray(data.value)
      )
        throw new Error("Invalid Azure board list");
      for (const item of data.value) values.push(item);
      if (pageSize) {
        if (data.value.length < pageSize) break;
        const last = summary(data.value.at(-1)).id;
        if (seen.has(last)) throw Error("Invalid Azure pagination");
        seen.add(last);
        url.searchParams.set("$skip", String(values.length));
        continue;
      }
      if (!continuationToken) break;
      if (seen.has(continuationToken))
        throw new Error("Invalid Azure pagination");
      seen.add(continuationToken);
      url.searchParams.set("continuationToken", continuationToken);
    }
    this.cache.set(path, { expires: Date.now() + 60000, values });
    return values;
  }
}
