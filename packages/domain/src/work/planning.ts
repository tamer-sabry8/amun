// Roadmap, Sprints, Library, Decisions and the Agents org chart (handoff §9).
import { riceScore, type RiceInputs } from "../rice.ts";

// ── Roadmap (Q37, Q63–Q64) ───────────────────────────────────────────────────
export const horizons = ["now", "next", "later"] as const;
export type Horizon = (typeof horizons)[number];
export const roadmapViews = [
  ["timeline", "Timeline"],
  ["horizon", "Now / Next / Later"],
  ["release", "By release / sprint"],
] as const;
export interface RoadmapItem extends RiceInputs {
  id: string;
  workAreaId: string;
  title: string;
  horizon: Horizon;
  position: number;
  committed: boolean;
  /** RICE inputs Firstmate guessed and the user has not confirmed. */
  estimated: boolean;
  release: string | null;
  start: string | null;
  end: string | null;
}
export function riceBadge(item: RoadmapItem) {
  const score = riceScore(item);
  // Empty stays empty, never zero.
  if (score === null) return null;
  return {
    text: `RICE ${Math.round(score)}`,
    estimated: item.estimated,
    label: item.estimated ? "estimated" : null,
  };
}
export function horizonBoard(items: RoadmapItem[]) {
  return horizons.map((horizon) => ({
    horizon,
    items: items
      .filter((item) => item.horizon === horizon)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)),
  }));
}
export function releaseGroups(items: RoadmapItem[]) {
  const groups = new Map<string, RoadmapItem[]>();
  for (const item of items) {
    const key = item.release ?? "Unscheduled";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) =>
      a === "Unscheduled" ? 1 : b === "Unscheduled" ? -1 : a.localeCompare(b),
    )
    .map(([release, list]) => ({ release, items: list }));
}
export type Resequence =
  | { apply: true; items: RoadmapItem[] }
  | {
      apply: false;
      needsApproval: true;
      proposal: RoadmapItem[];
      reason: string;
    };
/**
 * Dragging a draft item applies at once. Moving a committed item changes the
 * committed roadmap, which is a hard gate: it becomes a proposal to approve.
 */
export function resequence(
  items: RoadmapItem[],
  move: { id: string; horizon: Horizon; index: number },
): Resequence {
  const moving = items.find((item) => item.id === move.id);
  if (!moving) return { apply: true, items };
  const target = items
    .filter((item) => item.horizon === move.horizon && item.id !== move.id)
    .sort((a, b) => a.position - b.position);
  target.splice(Math.max(0, Math.min(move.index, target.length)), 0, {
    ...moving,
    horizon: move.horizon,
  });
  const positions = new Map(target.map((item, index) => [item.id, index]));
  const next = items.map((item) =>
    positions.has(item.id)
      ? {
          ...item,
          horizon: item.id === move.id ? move.horizon : item.horizon,
          position: positions.get(item.id)!,
        }
      : item,
  );
  const changedCommitment =
    moving.committed &&
    (moving.horizon !== move.horizon ||
      next.find((item) => item.id === move.id)!.position !== moving.position);
  return changedCommitment
    ? {
        apply: false,
        needsApproval: true,
        proposal: next,
        reason:
          "This item is on the committed roadmap. Moving it needs your approval.",
      }
    : { apply: true, items: next };
}
export function timelineBar(
  item: Pick<RoadmapItem, "start" | "end">,
  range: { start: string; end: string },
) {
  if (!item.start || !item.end) return null;
  const from = Date.parse(range.start);
  const span = Date.parse(range.end) - from;
  if (!(span > 0)) return null;
  const left = (Date.parse(item.start) - from) / span;
  const right = (Date.parse(item.end) - from) / span;
  if (!(right > 0) || !(left < 1)) return null;
  return {
    left: Math.max(0, left),
    width: Math.min(1, right) - Math.max(0, left),
  };
}

// ── Sprints (Q35, Q67) ───────────────────────────────────────────────────────
export const sprintViews = [
  ["overview", "Overview"],
  ["timeline", "Timeline"],
  ["plan", "Sprint plan"],
] as const;
export const sprintTabs = [
  "Summary",
  "Stories",
  "Pull requests",
  "Activity",
  "History",
] as const;
export const boardColumns = [
  "To do",
  "In development",
  "QA testing",
  "Done",
] as const;
export const storyChips = ["All", "PBI", "Bug", "Task", "Blocked"] as const;
export interface Sprint {
  id: string;
  workAreaId: string;
  workAreaName: string;
  name: string;
  team: string | null;
  start: string;
  end: string;
  goal: string;
  draft: boolean;
  done: number;
  total: number;
  blocked: number;
  changedInAdo: boolean;
}
const dayMs = 86_400_000;
const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;
export function sprintRow(sprint: Sprint, now: number) {
  const start = Date.parse(sprint.start);
  const end = Date.parse(sprint.end);
  const started = now >= start;
  return {
    title: `${sprint.workAreaName} · ${sprint.name}`,
    progress: `${sprint.done} / ${sprint.total} stories done`,
    timing: !started
      ? `Starts in ${days(Math.ceil((start - now) / dayMs))}`
      : now > end
        ? "Ended"
        : `${days(Math.ceil((end - now) / dayMs))} left`,
    flags: [
      ...(sprint.blocked ? [`${sprint.blocked} blocked`] : []),
      ...(!started ? ["Not started"] : []),
      ...(sprint.changedInAdo ? ["Changed in ADO"] : []),
    ],
  };
}
export function sprintOverview(
  sprints: Sprint[],
  now: number,
  workAreaId?: string,
) {
  return sprints
    .filter(
      (sprint) =>
        !sprint.draft &&
        Date.parse(sprint.end) >= now &&
        (!workAreaId || sprint.workAreaId === workAreaId),
    )
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

export interface PlanStory {
  id: string;
  title: string;
  points: number | null;
  owner: string | null;
}
export interface SprintPlan {
  goal: string;
  /** null = not known. Capacity is never invented. */
  capacity: number | null;
  stories: PlanStory[];
  out: PlanStory[];
}
export function planSummary(plan: SprintPlan) {
  const sized = plan.stories.filter((story) => story.points !== null);
  const load = sized.reduce((sum, story) => sum + story.points!, 0);
  const unsized = plan.stories.length - sized.length;
  const owners = new Map<string, PlanStory[]>();
  for (const story of plan.stories) {
    const key = story.owner ?? "Unassigned";
    owners.set(key, [...(owners.get(key) ?? []), story]);
  }
  return {
    load,
    unsized,
    capacity:
      plan.capacity === null
        ? { known: false as const, label: "Capacity not set · ask team" }
        : {
            known: true as const,
            ratio: plan.capacity ? load / plan.capacity : 0,
            over: load > plan.capacity,
            label: `${load} of ${plan.capacity} points`,
          },
    byOwner: [...owners.entries()].map(([owner, stories]) => ({
      owner,
      stories,
    })),
    // Feasibility is only ever claimed from known capacity.
    feasible: plan.capacity === null ? null : load <= plan.capacity,
    footer: "Preview only · No Azure DevOps changes",
  };
}
export function moveStory(
  plan: SprintPlan,
  storyId: string,
  to: { list: "stories" | "out"; owner?: string | null },
): SprintPlan {
  const story =
    plan.stories.find((item) => item.id === storyId) ??
    plan.out.find((item) => item.id === storyId);
  if (!story) return plan;
  const moved = to.owner === undefined ? story : { ...story, owner: to.owner };
  const without = (list: PlanStory[]) =>
    list.filter((item) => item.id !== storyId);
  return {
    ...plan,
    stories:
      to.list === "stories"
        ? [...without(plan.stories), moved]
        : without(plan.stories),
    out: to.list === "out" ? [...without(plan.out), moved] : without(plan.out),
  };
}

export interface PullRequest {
  id: string;
  title: string;
  state: "open" | "merged" | "closed";
  openedAt: string;
  mergedAt: string | null;
  reviewer: string | null;
}
export function pullStats(pulls: PullRequest[], now: number) {
  const open = pulls.filter((pull) => pull.state === "open");
  const waiting = open.filter(
    (pull) => now - Date.parse(pull.openedAt) > 3 * dayMs,
  ).length;
  const noReviewer = open.filter((pull) => !pull.reviewer).length;
  const merged = pulls
    .filter((pull) => pull.state === "merged" && pull.mergedAt)
    .map(
      (pull) =>
        (Date.parse(pull.mergedAt!) - Date.parse(pull.openedAt)) / dayMs,
    )
    .sort((a, b) => a - b);
  const median = merged.length
    ? merged.length % 2
      ? merged[(merged.length - 1) / 2]!
      : (merged[merged.length / 2 - 1]! + merged[merged.length / 2]!) / 2
    : null;
  return {
    text: [
      `${open.length} open`,
      `${waiting} waiting > 3 days`,
      `${noReviewer} without reviewer`,
      median === null
        ? "no merges yet"
        : `median time to merge ${days(Math.round(median))}`,
    ].join(" · "),
    open: open.length,
    waiting,
    noReviewer,
    median,
  };
}
/** Calendar exceptions appear only when configured; holidays are never inferred. */
export function calendarNote(exceptions: { date: string; label: string }[]) {
  return exceptions.length
    ? null
    : "Calendar exceptions appear here when configured. Holidays are not inferred from location.";
}

// ── Library (Q39, Q59) ───────────────────────────────────────────────────────
export interface LibraryItem {
  id: string;
  section: "output" | "record";
  type: string;
  title: string;
  groupId: string | null;
  workAreaIds: string[];
  status: string;
  needsLinking: boolean;
  updatedAt: string;
}
export interface LibraryQuery {
  /** Null when "Browse all permitted" is on. */
  workAreaId: string | null;
  /** Groups the user may see here; the active group unless permitted wider. */
  groupIds: string[] | null;
  type?: string | null;
  needsLinking?: boolean;
  text?: string;
  groupBy?: "work" | "type" | "none";
}
export function library(items: LibraryItem[], query: LibraryQuery) {
  const text = query.text?.trim().toLowerCase();
  const visible = items
    .filter(
      (item) =>
        // Group separation applies before anything else is considered.
        (query.groupIds === null ||
          item.groupId === null ||
          query.groupIds.includes(item.groupId)) &&
        (query.workAreaId === null ||
          item.workAreaIds.includes(query.workAreaId)) &&
        (!query.type || item.type === query.type) &&
        (!query.needsLinking || item.needsLinking) &&
        (!text || item.title.toLowerCase().includes(text)),
    )
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    );
  const by = query.groupBy ?? "none";
  if (by === "none") return [{ key: "", items: visible }];
  const groups = new Map<string, LibraryItem[]>();
  for (const item of visible) {
    const keys =
      by === "type"
        ? [item.type]
        : item.workAreaIds.length
          ? item.workAreaIds
          : [""];
    for (const key of keys) groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    .map(([key, list]) => ({ key, items: list }));
}

// ── Decisions (Q38, Q62) ─────────────────────────────────────────────────────
export interface Decision {
  id: string;
  groupId: string | null;
  workAreaId: string | null;
  what: string;
  options: string[];
  decidedBy: "you" | "client" | "firstmate_recommended" | null;
  decidedAt: string | null;
  outcome: string | null;
  affected: string[];
  source: "conversation" | "council" | "exception";
}
export function decisionLog(
  decisions: Decision[],
  scope: { workAreaId: string | null; groupIds: string[] | null },
) {
  const visible = decisions.filter(
    (decision) =>
      (scope.groupIds === null ||
        decision.groupId === null ||
        scope.groupIds.includes(decision.groupId)) &&
      (scope.workAreaId === null || decision.workAreaId === scope.workAreaId),
  );
  return {
    // Pending items link to the Island; there is no second answer button here.
    waiting: visible.filter((decision) => decision.outcome === null),
    recorded: visible
      .filter((decision) => decision.outcome !== null)
      .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? "")),
  };
}

// ── Agents org chart (Q19, Q36, Q61) ─────────────────────────────────────────
export interface AgentCard {
  id: string;
  role: string;
  kind: "lead" | "always_on" | "temporary";
  launcherId: string | null;
  state: "working" | "waiting" | "idle" | "done";
  nowDoing: string | null;
}
export interface AgentNode extends AgentCard {
  children: AgentNode[];
  /** Temporary agents fade once their task is finished. */
  fading: boolean;
  icon: "lead" | "pin" | "timer";
  status: string;
}
const statusText = {
  working: "Working",
  waiting: "Waiting on you",
  idle: "Idle",
  done: "Finished",
} as const;
export function orgChart(agents: AgentCard[]): AgentNode | null {
  const lead = agents.find((agent) => agent.kind === "lead");
  if (!lead) return null;
  const node = (agent: AgentCard): AgentNode => ({
    ...agent,
    icon:
      agent.kind === "lead"
        ? "lead"
        : agent.kind === "always_on"
          ? "pin"
          : "timer",
    fading: agent.kind === "temporary" && agent.state === "done",
    status: statusText[agent.state],
    children: agents
      .filter(
        (child) =>
          child.id !== agent.id &&
          child.kind !== "lead" &&
          // An agent with no known launcher sits under the lead.
          (child.launcherId ?? lead.id) === agent.id,
      )
      .sort(
        (a, b) =>
          Number(a.kind === "temporary") - Number(b.kind === "temporary") ||
          a.role.localeCompare(b.role),
      )
      .map(node),
  });
  return node(lead);
}
