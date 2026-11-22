// What a work area has in Jira and Linear, read back for Amun's Stories tab
// and Sprints screen. The record is Amun's own: the plans the captain
// approved for this work area and the items they created (key, link, parent,
// sprint). The provider is asked only for what changes there (status, sprint
// state and dates); a failed read keeps the recorded value and says so.
import type { Database } from "../sqlite.ts";
import type { PlanWriteItem } from "../plan-publication.ts";
import { JiraWriter, jiraSite } from "./jira-target.ts";
import { LinearWriter } from "./linear-target.ts";
import { jiraSites } from "./tracker-target.ts";
import {
  text,
  trackerStep,
  type StepKind,
  type TrackerId,
  type TrackerSession,
} from "./tracker-items.ts";

export interface DeliveryItem {
  provider: TrackerId;
  planId: string;
  itemId: string;
  kind: StepKind;
  /** The provider's type ("Epic", "Task", "Sprint", "Project", …). */
  type: string;
  title: string;
  acceptance: string[];
  /** SCRUM-17, TRA-7, P-TRA-2, or a sprint id; null until it exists there. */
  key: string | null;
  url: string | null;
  /** The epic this item sits under (its plan item id), when it has one. */
  epicId: string | null;
  /** The sprint or cycle this item is in (its plan item id or provider id). */
  sprintId: string | null;
  /** Workflow status or sprint state, as the provider reported it. */
  status: string | null;
  start: string | null;
  end: string | null;
  /** created, failed or unknown, from Amun's publication record. */
  outcome: "created" | "failed" | "unknown";
}

export interface Delivery {
  items: DeliveryItem[];
  /** When the provider was last read for these items (null: not read). */
  readAt: string | null;
  /** Providers that could not be read, with the reason, in plain words. */
  unread: { provider: TrackerId; reason: string }[];
}

interface PlanRow {
  id: string;
  destination: string;
  items_json: string;
  results_json: string | null;
}

interface ResultRow {
  id: string;
  state: "created" | "failed" | "unknown";
  externalId?: string;
  url?: string;
}

const lines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** Amun's own record of the Jira and Linear items published for an area. */
export function deliveryRecords(
  db: Database,
  workAreaId: string,
): DeliveryItem[] {
  const plans = db
    .prepare(
      "SELECT id,destination,items_json,results_json FROM work_plans WHERE work_area_id=? AND destination IN ('jira','linear') AND results_json IS NOT NULL ORDER BY created_at,rowid",
    )
    .all(workAreaId) as PlanRow[];
  const items: DeliveryItem[] = [];
  for (const plan of plans) {
    const provider = plan.destination as TrackerId;
    const planItems = JSON.parse(plan.items_json) as Omit<
      PlanWriteItem,
      "marker" | "destination"
    >[];
    const results = new Map(
      (JSON.parse(plan.results_json ?? "[]") as ResultRow[]).map((r) => [
        r.id,
        r,
      ]),
    );
    const steps = planItems.flatMap((item) => {
      try {
        return [
          {
            item,
            step: trackerStep(provider, {
              ...item,
              marker: "",
              destination: provider,
            }),
          },
        ];
      } catch {
        return [];
      }
    });
    // Item ids are unique only within their plan, so every id here carries
    // the plan's. A parent or sprint names another item of the same plan (by
    // id or title) or something already in the provider (a key, a sprint id
    // or a Linear cycle number), which gets the provider's own scope.
    const scoped = (id: string) => `${plan.id}:${id}`;
    const local = (ref: string | null, kind: StepKind, scope: string) => {
      if (!ref) return null;
      const wanted = ref.trim().toLowerCase();
      const found = steps.find(
        ({ item, step }) =>
          step.kind === kind &&
          (item.id === ref || step.title.trim().toLowerCase() === wanted),
      );
      if (found) return scoped(found.item.id);
      return kind === "sprint"
        ? providerSprint(provider, scope, ref)
        : `${provider}:key:${ref}`;
    };
    for (const { item, step } of steps) {
      const result = results.get(item.id);
      if (!result) continue;
      items.push({
        provider,
        planId: plan.id,
        itemId: scoped(item.id),
        kind: step.kind,
        type: step.issueType,
        title: step.title,
        acceptance: lines(step.acceptance),
        key: result.externalId ?? null,
        url: result.url ?? null,
        epicId:
          step.kind === "story" ? local(step.parent, "epic", step.site) : null,
        sprintId:
          step.kind === "story"
            ? local(
                step.sprint,
                "sprint",
                provider === "linear"
                  ? linearTeam(result.externalId ?? null, step.team ?? "")
                  : step.site,
              )
            : null,
        status: null,
        start: step.kind === "sprint" ? step.start : null,
        end: step.kind === "sprint" ? step.end : null,
        outcome: result.state,
      });
    }
  }
  return items;
}

export interface DeliveryAccess {
  configured(provider: TrackerId): Promise<boolean>;
  use<T>(
    provider: TrackerId,
    work: (session: TrackerSession) => Promise<T>,
  ): Promise<T>;
}

/**
 * The record with what the providers say now. Each provider is read once,
 * only for items that exist there; nothing is written.
 */
export async function readDelivery(
  db: Database,
  workAreaId: string,
  access: DeliveryAccess,
  now: () => Date = () => new Date(),
): Promise<Delivery> {
  const items = deliveryRecords(db, workAreaId);
  const unread: Delivery["unread"] = [];
  let read = false;
  for (const provider of ["jira", "linear"] as const) {
    const mine = items.filter(
      (i) => i.provider === provider && i.key && i.outcome === "created",
    );
    if (!mine.length) continue;
    if (!(await access.configured(provider))) {
      unread.push({ provider, reason: "not connected" });
      continue;
    }
    try {
      await access.use(provider, (session) =>
        provider === "jira"
          ? readJira(session, mine, items)
          : readLinear(session, mine),
      );
      read = true;
    } catch (error) {
      unread.push({
        provider,
        reason: error instanceof Error ? error.message : "could not be read",
      });
    }
  }
  return { items, readAt: read ? now().toISOString() : null, unread };
}

/**
 * A provider sprint not in any plan, scoped where its id is unique: a Jira
 * sprint id within its site, a Linear cycle number within its team.
 */
export const providerSprint = (
  provider: TrackerId,
  scope: string,
  id: string,
) =>
  provider === "linear"
    ? `linear:cycle:${scope.toUpperCase()}:${id}`
    : `jira:sprint:${scope.toLowerCase()}:${id}`;

/** The Linear team of an issue key (TRA-12 → TRA). */
export const linearTeam = (key: string | null, fallback: string) =>
  key && /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(key)
    ? key.replace(/-\d+$/, "")
    : fallback;

const hostOf = (url: string | null) => {
  try {
    return url ? new URL(url).host.toLowerCase() : null;
  } catch {
    return null;
  }
};

/** Each item is read from the Jira site it was published to. */
async function readJira(
  session: TrackerSession,
  mine: DeliveryItem[],
  all: DeliveryItem[],
) {
  const sites = await jiraSites(session);
  const hosts = [...new Set(mine.map((item) => hostOf(item.url)))].filter(
    (host): host is string => host !== null,
  );
  for (const host of hosts)
    await readJiraSite(
      new JiraWriter(session, jiraSite(sites, host)),
      host,
      mine.filter((item) => hostOf(item.url) === host),
      all.filter((item) => hostOf(item.url) === host),
    );
}

async function readJiraSite(
  jira: JiraWriter,
  host: string,
  mine: DeliveryItem[],
  all: DeliveryItem[],
) {
  const sprintsByBoard = new Map<number, Record<string, unknown>[]>();
  for (const item of mine) {
    if (item.kind === "sprint") {
      const board = Number(/\/boards\/(\d+)/.exec(item.url ?? "")?.[1]);
      if (!Number.isFinite(board)) continue;
      if (!sprintsByBoard.has(board))
        sprintsByBoard.set(board, await jira.sprints(board));
      const sprint = sprintsByBoard
        .get(board)!
        .find((s) => String(s.id) === item.key);
      if (!sprint) continue;
      item.status = text(sprint.state);
      item.title = text(sprint.name) ?? item.title;
      item.start = text(sprint.startDate)?.slice(0, 10) ?? item.start;
      item.end = text(sprint.endDate)?.slice(0, 10) ?? item.end;
      continue;
    }
    const now = await jira.issue(item.key!);
    item.status = now.status;
    item.title = now.summary || item.title;
    // Jira's own sprint membership wins over the plan's intent, including
    // when the story was taken out of every sprint.
    const sprint = now.sprints[0];
    const known = sprint
      ? all.find((s) => s.kind === "sprint" && s.key === sprint)
      : undefined;
    item.sprintId = sprint
      ? (known?.itemId ?? providerSprint("jira", host, sprint))
      : null;
  }
}

async function readLinear(session: TrackerSession, mine: DeliveryItem[]) {
  const linear = new LinearWriter(session);
  for (const item of mine) {
    if (item.kind !== "story" || !item.key) continue;
    const now = await linear.issueNow(item.key);
    item.status = now.status;
    // Linear cannot create cycles, so a cycle is only ever a membership.
    item.sprintId = now.cycle
      ? providerSprint("linear", linearTeam(item.key, ""), now.cycle)
      : null;
    item.title = now.title ?? item.title;
    item.url = now.url ?? item.url;
  }
}
