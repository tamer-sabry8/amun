// What an approved plan item means for Linear or Jira. The captain approves
// the plan's exact items (work_plans fingerprint); every destination value
// the write uses (site, project or team, board, parent, sprint) is a field of
// that item, so the approval is bound to the destination as well as the
// content. Nothing here talks to a provider.
import { PlanRefused, type PlanWriteItem } from "../plan-publication.ts";

export type TrackerId = "linear" | "jira";

/** One short MCP session with the provider (structurally McpSession). */
export interface TrackerSession {
  readonly tools: readonly { name: string }[];
  call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{
    isError?: boolean | undefined;
    content?: unknown;
    structuredContent?: unknown;
  }>;
}

export type StepKind = "epic" | "story" | "sprint";

export interface TrackerStep {
  kind: StepKind;
  /** The provider's own issue type for epics and stories ("Story", "Task", …). */
  issueType: string;
  title: string;
  description: string;
  acceptance: string;
  /** Jira site host (example.atlassian.net) or Linear workspace URL key. */
  site: string;
  /** Jira project key. */
  project: string | null;
  /** Linear team key or name. */
  team: string | null;
  /** Jira board id, for sprints. */
  board: number | null;
  /** A plan item id or an existing key (PROJ-1, ENG-1). */
  parent: string | null;
  /** A plan item id or an existing sprint id / cycle number. */
  sprint: string | null;
  start: string | null;
  end: string | null;
  goal: string;
  startSprint: boolean;
  /** Linear epics: a Linear project (default) or a parent issue. */
  epicAs: "project" | "issue";
  marker: string;
}

const norm = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A field by any of its spellings ("Acceptance criteria", "acceptanceCriteria"). */
export function field(
  fields: Record<string, string | number | null>,
  ...names: string[]
): string | null {
  const wanted = new Set(names.map(norm));
  for (const [key, value] of Object.entries(fields)) {
    if (!wanted.has(norm(key)) || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const label = { linear: "Linear", jira: "Jira" } as const;

/** The marker label Jira can search exactly. */
export const markerLabel = (marker: string) =>
  "amun-" + marker.replace(/-/g, "").toLowerCase();
/** The line every created item carries, so an uncertain write can be found. */
export const markerLine = (marker: string) => `Amun publication ID: ${marker}`;

/** Turns an approved item into a step, or refuses it before anything is sent. */
export function trackerStep(
  provider: TrackerId,
  item: PlanWriteItem,
): TrackerStep {
  const f = item.fields;
  const refuse = (why: string): never => {
    throw new PlanRefused(`${label[provider]} refused it: ${why}`);
  };
  const type = field(f, "type", "issue type", "work item type") ?? "Story";
  const lower = type.toLowerCase();
  const kind: StepKind =
    lower === "epic" || (provider === "linear" && lower === "project")
      ? "epic"
      : lower === "sprint" || lower === "cycle"
        ? "sprint"
        : "story";
  const site = field(f, "site", "workspace", "cloud", "url");
  if (!site) refuse("the plan does not name the site or workspace");
  const project = field(f, "project", "project key");
  const team = field(f, "team", "team key");
  if (provider === "jira" && !project)
    refuse("the plan does not name the Jira project");
  if (provider === "linear" && !team)
    refuse("the plan does not name the Linear team");
  const boardText = field(f, "board", "board id");
  const board = boardText === null ? null : Number(boardText);
  if (board !== null && (!Number.isSafeInteger(board) || board <= 0))
    refuse("the board must be a Jira board number");
  const start = field(f, "start", "start date");
  const end = field(f, "end", "end date", "finish", "finish date");
  for (const date of [start, end])
    if (date !== null && !DATE.test(date)) refuse("dates must be YYYY-MM-DD");
  if (start && end && start > end) refuse("the sprint ends before it starts");
  const title = (field(f, "title", "name") ?? item.summary).trim();
  if (!title || title.length > 255)
    refuse("the title must be 1 to 255 characters");
  const startSprint = /^(yes|true|start|1)$/i.test(
    field(f, "start sprint", "start now", "activate") ?? "",
  );
  if (kind === "sprint") {
    if (provider === "linear")
      refuse(
        "Linear's MCP server cannot create or start cycles. Create the cycle in Linear (or let the team's cycle schedule make it), then plan stories into it by number",
      );
    if (board === null) refuse("a Jira sprint needs its board number");
    if (startSprint && (!start || !end))
      refuse("a sprint can only start with both dates set");
  }
  const as = (field(f, "epic as", "as") ?? "project").toLowerCase();
  return {
    kind,
    issueType: kind === "epic" ? "Epic" : type,
    title,
    description: field(f, "description", "body", "details") ?? "",
    acceptance: field(f, "acceptance criteria", "acceptance", "ac") ?? "",
    // Jira: the site host. Linear: the workspace URL key (linear.app/<key>).
    site: (provider === "linear"
      ? site!.replace(/^https?:\/\/linear\.app\//i, "").replace(/\/.*$/, "")
      : site!.replace(/^https?:\/\//i, "").replace(/\/.*$/, "")
    ).toLowerCase(),
    project: project ? project.toUpperCase() : null,
    team,
    board,
    parent: field(f, "parent", "epic", "parent key"),
    sprint: field(f, "sprint", "cycle", "sprint id"),
    start,
    end,
    goal: field(f, "goal", "sprint goal") ?? "",
    startSprint,
    epicAs: as === "issue" ? "issue" : "project",
    marker: item.marker,
  };
}

/** Markdown body: description, acceptance criteria, then the marker line. */
export function trackerBody(step: TrackerStep) {
  return [
    step.description,
    step.acceptance ? `## Acceptance criteria\n\n${step.acceptance}` : "",
    `---\n${markerLine(step.marker)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The JSON (or text) a tool answered with. */
export function toolData(result: {
  content?: unknown;
  structuredContent?: unknown;
}): unknown {
  if (result.structuredContent && typeof result.structuredContent === "object")
    return result.structuredContent;
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text: unknown }).text)
        : "",
    )
    .join("");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const text = (value: unknown) =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : null;

/** The provider's refusal text, bounded and without links or secrets. */
export function refusalText(result: { content?: unknown }) {
  const data = toolData(result);
  const raw = typeof data === "string" ? data : JSON.stringify(data);
  return raw
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/(bearer|token|secret|password)[\s:="]+\S+/gi, "$1 [removed]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** A tool the step needs; missing means nothing can be sent. */
export function requireTool(
  provider: TrackerId,
  session: TrackerSession,
  name: string,
) {
  if (!session.tools.some((tool) => tool.name === name))
    throw new PlanRefused(
      `${label[provider]} refused it: its MCP server does not offer ${name} to this connection`,
    );
}

/**
 * Waits before a marker search may count as "not there". Jira's (and
 * Linear's) search index trails a create by seconds: seen live on 22
 * November 2026, a lost reply plus an immediate empty search created the
 * same issue twice.
 */
export const SEARCH_SETTLE_MS = [0, 2000, 4000, 6000, 8000];
export type Wait = (ms: number) => Promise<void>;
export const realWait: Wait = (ms) =>
  ms ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

/** Searches until something is found or the index has had time to settle. */
export async function settledSearch<T>(
  search: () => Promise<T[]>,
  wait: Wait = realWait,
): Promise<T[]> {
  for (const delay of SEARCH_SETTLE_MS) {
    await wait(delay);
    const found = await search();
    if (found.length) return found;
  }
  return [];
}

/** Earliest of several items with one marker, and a note naming the rest. */
export function earliest(keys: string[]) {
  const sorted = [...keys].sort(
    (a, b) =>
      Number(/\d+$/.exec(a)?.[0] ?? 0) - Number(/\d+$/.exec(b)?.[0] ?? 0),
  );
  return {
    key: sorted[0]!,
    note:
      sorted.length > 1
        ? ` ${sorted.slice(1).join(", ")} carries the same Amun marker: it is a duplicate to remove.`
        : "",
  };
}
