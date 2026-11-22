import { newRequestRef } from "../../../domain/src/work/requests.ts";
// Answers the renderer's existing port contracts (@amun/contracts) from the
// daemon's /amun RPC, so every screen keeps its current shape. Products become
// products and groups. Every product shares the captain's one Firstmate home,
// so the fleet (agents), captain holds (attention) and the First Mate chat are
// home-wide and appear once, not once per product.
import {
  draftingRule,
  heldInstruction,
  heldOutcome,
  prdDiscoveryCharterRule,
} from "../../../domain/src/work/held-tasks.ts";
import {
  firstmateNotice,
  type FirstmateNotice,
} from "../../../domain/src/work/firstmate-notice.ts";
import { generalConversationName } from "../../../domain/src/work/model.ts";
import { workspaceSnapshot, type WorkspaceSnapshot } from "@amun/contracts";
import {
  workAttachment,
  workCommand,
  workDelegate,
  workSnapshot,
  type WorkSnapshot,
} from "../../../contracts/src/work.ts";
import { NavigationQueue } from "./navigation.ts";
import { NoticeQueue, type NoticeOptions } from "./firstmate-notices.ts";
import { AmunRequestError, type AmunTransport } from "./amun-client.ts";
import { agentCatalog } from "../../../domain/src/work/agents.ts";
import { pickByName } from "../../../domain/src/work/shell.ts";

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Known Firstmate/Herdr secondmate ids that already own an Amun catalog role
 * (for example in the captain's data/secondmates.md roster).
 */
const secondmateRoleAliases: Record<string, string> = {
  researcher: "Research & Insights",
  prd: "Product Manager",
  designer: "UX",
  "product-marketing": "Product Marketing",
  video: "Content",
  "solution-architect": "Solution & AI Architecture",
  bid: "Proposal & Bid",
  presales: "Presales & Solutioning",
};

/** A secondmate whose id names a pool specialist shows on that card. */
export function poolRole(taskId: string): string | null {
  const id = slug(taskId);
  if (secondmateRoleAliases[id]) return secondmateRoleAliases[id]!;
  for (const [alias, role] of Object.entries(secondmateRoleAliases)) {
    if (id.startsWith(alias + "-")) return role;
  }
  const found = agentCatalog.find((profile) => {
    const name = slug(profile.name);
    return id === name || id.startsWith(name + "-");
  });
  return found?.name ?? null;
}

/**
 * What Amun asks the First Mate when the captain changes the team. Amun never
 * provisions or tears down agents itself; Firstmate does, its own way.
 */
export function teamRequest(
  action: "add" | "retire" | "edit",
  role: string,
  detail = "",
): string {
  if (action === "add")
    return (
      `The captain asks you to add "${role}" to the team as a secondmate` +
      (detail ? ` (${detail})` : "") +
      ". Please brief it, seed its home and spawn it your usual way " +
      "(fm-brief, fm-home-seed, fm-spawn --secondmate)."
    );
  if (action === "retire")
    return (
      `The captain asks you to retire the "${role}" secondmate. First save its ` +
      "open work and notes into data/<id>/ and archive its status history, " +
      "then tear it down with fm-teardown. Amun puts its card back in the pool."
    );
  return `The captain wants this change to the "${role}" secondmate: ${detail}`;
}

/**
 * What Amun asks the First Mate when a conversation hands a job to an agent.
 * Amun starts no worker itself: the First Mate gives the job to the
 * secondmate whose charter fits (briefing and spawning one if there is none)
 * through Firstmate's own scripts, supervises it, and reports back.
 */
export function delegationRequest(job: {
  agent: string;
  title: string;
  task: string;
  acceptance?: boolean | undefined;
  repo?: string | undefined;
}): string {
  return [
    `The captain's conversation hands this job to the "${job.agent}" agent: "${job.title}".`,
    "Give it to the secondmate whose charter fits that role your usual way " +
      "(fm-send to a live one; otherwise fm-brief, fm-home-seed, fm-spawn --secondmate), " +
      "or spawn crew for it with fm-spawn if that fits better. Do not do the work yourself. " +
      "Supervise it, and tell the captain in plain words who is on it now and the result when it is back.",
    ...(job.acceptance
      ? [
          "It is an acceptance checklist: every item must cite its evidence, and the captain decides whether it is accepted.",
        ]
      : []),
    ...(job.repo
      ? [
          `It changes code in ${job.repo}. The crew works in its own treehouse worktree; nothing is merged without the captain's word.`,
        ]
      : []),
    "",
    "The job:",
    job.task,
  ].join("\n");
}

export interface DaemonSpace {
  slug: string;
  name: string;
}
export type DaemonHold =
  | {
      source: "backlog";
      taskId: string;
      title: string;
      reason: string;
      until: string | null;
    }
  | {
      source: "crew";
      taskId: string;
      key: string;
      verb: string;
      summary: string;
    };
export interface DaemonFleetTask {
  id: string;
  kind?: string | null;
  current_state?: { state: string; detail: string };
  hints?: { last_event_text?: string | null };
}
export interface DaemonView {
  spaces: DaemonSpace[];
  /** Products, mapped sources and product context, kept by the daemon. */
  workspace?: WorkspaceSnapshot | null;
  fleet: DaemonFleetTask[];
  holds: DaemonHold[];
  /** Amun's own work model from the daemon's work store; null until read. */
  work: WorkSnapshot | null;
}

export interface DaemonConnection {
  id: string;
  kind: "ado" | "github" | "notion" | "obsidian" | "linear" | "jira";
  baseUrl: string;
  status: string;
  user: string | null;
  projects: { id: string; name: string }[];
  message: string | null;
}

interface TrackerStatus {
  status?: string;
  message?: string | null;
  identity?: { sites?: { url?: string | null; name?: string }[] } | null;
}

/**
 * A Jira or Linear status as the Tools card reads it: "auth-status" with the
 * id jira-mcp / linear-mcp, and where the sign-in leads once it works.
 */
export function trackerStatusEvent(
  provider: "jira" | "linear",
  status: TrackerStatus,
) {
  const sites = (status.identity?.sites ?? [])
    .map((site) =>
      (site.url ?? site.name ?? "")
        .replace(/^https:\/\/(linear\.app\/)?/, "")
        .replace(/\/$/, ""),
    )
    .filter(Boolean);
  const known = ["missing", "configured", "checking", "ready", "error"];
  const value = known.includes(String(status.status))
    ? String(status.status)
    : "error";
  const detail =
    value === "ready" && sites.length
      ? provider === "jira"
        ? sites.join(", ")
        : `Workspace ${sites.join(", ")}`
      : "";
  return {
    version: 1,
    kind: "auth-status",
    id: `${provider}-mcp`,
    status: value,
    ...(detail ? { detail: detail.slice(0, 512) } : {}),
  };
}

/** What a connection check found, in words the captain can act on. */
export function describeAdo(view: DaemonConnection): string {
  if (view.status !== "ready")
    return view.message ?? "Azure DevOps is not connected.";
  const who = view.user ? ` as ${view.user}` : "";
  const names = view.projects.map((project) => project.name);
  const shown = names.slice(0, 5).join(", ");
  const more = names.length > 5 ? ` and ${names.length - 5} more` : "";
  return names.length
    ? `Connected to Azure DevOps${who}. It can read ${names.length} project${names.length === 1 ? "" : "s"}: ${shown}${more}. Write access is confirmed the first time you approve a change.`
    : `Connected to Azure DevOps${who}, but the token can't see any projects yet.`;
}

/**
 * The day a hold was put off to, when it was. Firstmate keeps a deferred
 * hold in its lists: a task records the day, and a crew member's open
 * question only says so in its words ("Deferred by the captain to
 * 2026-11-23."). Either way the owner asked not to see it before then.
 */
export function heldUntil(hold: DaemonHold): string | null {
  if (hold.source === "backlog" && hold.until) {
    const day = /\d{4}-\d{2}-\d{2}/.exec(hold.until);
    if (day) return day[0];
  }
  const words = hold.source === "backlog" ? hold.reason : hold.summary;
  const said =
    /\b(?:deferred|put off|postponed|snoozed)\b[^.]*?\b(?:to|until|till)\s+(\d{4}-\d{2}-\d{2})/i.exec(
      words,
    );
  return said ? said[1]! : null;
}

/** Holds the owner should see today: not the ones put off to a later day. */
export function holdsDue(
  holds: readonly DaemonHold[],
  now: string,
): DaemonHold[] {
  const today = now.slice(0, 10);
  return holds.filter((hold) => {
    const until = heldUntil(hold);
    return !until || until <= today;
  });
}

export function holdId(hold: DaemonHold): string {
  return hold.source === "crew"
    ? `hold:${hold.taskId}:${hold.key}`
    : `hold:${hold.taskId}`;
}

export const FIRST_MATE_ID = "firstmate";

export function agentState(
  task: DaemonFleetTask,
): WorkSnapshot["agents"][number]["state"] {
  const state = task.current_state?.state ?? "";
  if (state === "working") return "working";
  if (state === "needs-decision" || state === "blocked") return "waiting";
  if (state === "done") return "done";
  return "idle";
}

/** Every product shares the one home, so any product reaches the First Mate. */
export function activeSpace(view: DaemonView): string | null {
  return view.spaces[0]?.slug ?? null;
}

export function toWorkspaceSnapshot(view: DaemonView): WorkspaceSnapshot {
  return workspaceSnapshot.parse({
    version: 1,
    kind: "workspace-snapshot",
    preferences: { productId: activeSpace(view) },
    products: view.spaces.map((space) => ({
      id: space.slug,
      name: space.name,
    })),
    attention: [],
    activities: [],
    notifications: [],
    artifacts: [],
    skills: [],
  });
}

const EMPTY_WORK = {
  version: 1,
  kind: "work-snapshot",
  setup: {},
  groups: [],
  routes: [],
  areas: [],
  relations: [],
  records: [],
  objectives: [],
  permissions: [],
  grants: [],
  rules: [],
  ruleCandidate: null,
  attention: [],
  plans: [],
  blockers: [],
  reminders: [],
  rfps: [],
  roadmap: [],
  sprints: [],
  calendar: [],
  library: [],
  decisions: [],
  agents: [],
  activity: [],
  council: [],
  findings: [],
  memory: { unsynced: 0, disputed: 0, facts: [] },
  messages: [],
};

/**
 * Asks the First Mate, once, to make Amun's agents real second mates (owner,
 * 19 November 2026). Firstmate provisions them its own way; Amun writes
 * nothing in the Firstmate home.
 */
export function poolRegistrationRequest(): string {
  const lines = agentCatalog.map(
    (profile) =>
      `- ${profile.name}: ${profile.scope}. Produces: ${profile.outputs}.`,
  );
  return [
    "The captain asked that every agent on Amun's Agents screen be one of your registered second mates, so you can route work to each of them by scope. This is a concrete, standing instruction from the captain for these agents.",
    "For each agent below: if a second mate you already have covers the same scope (for example your Designer, Researcher or PRD), keep that one and widen its registered scope to match; do not create a duplicate. Otherwise register a new persistent second mate with that name and scope, through your own second-mate provisioning.",
    "Do not start them all now. Register each one, and start it the first time you route work to it; it then stays. Keep any limits your existing second mates carry (for example personal-only roles).",
    "When you are done, tell the captain in a few lines which were matched to existing second mates, which were newly registered, and any you could not register and why.",
    "",
    ...lines,
  ].join("\n");
}

/** "saas-devops" as "Saas Devops": a crewmate's id as a name. */
export function crewName(id: string): string {
  if (id.toLowerCase() === "prd") return "Product Manager (PRD)";
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

/** Firstmate's own status wording, in words the captain can act on. */
export function plainCrewDetail(detail: string | null | undefined) {
  if (!detail) return detail ?? null;
  const missed = /pending-reply-missed:.*?request=(.*)$/s.exec(detail);
  if (missed)
    return `Has not answered Firstmate’s last request: “${missed[1]!.trim()}” It may be waiting at a prompt in its own window. Open Watch to see it, or ask Firstmate to unblock it.`;
  if (/no current-state source/i.test(detail)) return "Nothing to report yet.";
  return detail
    .replace(/^(?:blocked|needs-decision|done|resolved)\s*/i, "")
    .replace(/\[(?:key|at|corr)=[^\]]*\]\s*:?\s*/g, "")
    .replace(/\bcorr=[0-9a-f]+\s*/g, "")
    .trim();
}

/** Keep the crew's full report on the Agents screen and surface its decision here. */
function crewQuestion(summary: string) {
  const clean = plainCrewDetail(summary) ?? "";
  const question =
    /(?:^|\s)(?:Q\s*1|Question\s+1)\s*[-–—:]\s*([^?]{1,400}\?)/i.exec(clean);
  if (question) return question[1]!.trim();
  return clean.length > 200 ? clean.slice(0, 197).trimEnd() + "…" : clean;
}

/** The First Mate and its live crew, from Firstmate's fleet snapshot. */
export function fleetAgents(view: DaemonView): WorkSnapshot["agents"] {
  const agents: WorkSnapshot["agents"] = [
    {
      id: FIRST_MATE_ID,
      role: "First Mate",
      kind: "lead",
      launcherId: null,
      state: view.holds.length > 0 ? "waiting" : "idle",
      nowDoing: null,
      output: "",
      enabled: true,
    },
  ];
  for (const task of view.fleet) {
    agents.push({
      id: `crew:${task.id}`,
      role: poolRole(task.id) ?? crewName(task.id),
      kind: "temporary",
      launcherId: FIRST_MATE_ID,
      state: view.holds.some(
        (hold) => hold.source === "crew" && hold.taskId === task.id,
      )
        ? "waiting"
        : agentState(task),
      nowDoing: plainCrewDetail(task.current_state?.detail) || null,
      output: plainCrewDetail(task.hints?.last_event_text) ?? "",
      enabled: true,
    });
  }
  return agents;
}

const waitingAnswersKey = "amun.waiting-hold-answers";
function loadWaitingAnswers(): Map<string, HoldAnswer> {
  try {
    const raw = JSON.parse(
      globalThis.localStorage?.getItem(waitingAnswersKey) ?? "{}",
    ) as Record<string, HoldAnswer>;
    return new Map(
      Object.entries(raw).filter(
        ([, answered]) =>
          answered?.status === "waiting" &&
          typeof answered.signature === "string",
      ),
    );
  } catch {
    return new Map();
  }
}

/** What one hold says, so the same task held again is seen as a new hold. */
export function holdSignature(hold: DaemonHold): string {
  return JSON.stringify(hold);
}

/**
 * Forgets an answer once its hold is a different one: Firstmate cleared the
 * hold and the task was held again, or the hold now says something else.
 * A fresh question on the same task is never shown as already answered.
 */
export function settleHoldAnswers(
  answers: Map<string, HoldAnswer>,
  holds: readonly DaemonHold[],
): void {
  const present = new Map(holds.map((hold) => [holdId(hold), hold]));
  for (const [id, answered] of answers) {
    const hold = present.get(id);
    if (answered.status === "waiting") {
      // Checked before anything is sent again: a hold that is gone was
      // settled (by this answer or elsewhere); a changed one is asked anew.
      if (!hold) answers.set(id, { ...answered, status: "settled" });
      else if (holdSignature(hold) !== answered.signature) answers.delete(id);
      continue;
    }
    if (!hold) {
      if (answered.status === "recorded" && !answered.cleared)
        answers.set(id, { ...answered, cleared: true });
    } else if (answered.cleared || holdSignature(hold) !== answered.signature)
      answers.delete(id);
  }
}

/** What the owner answered to a held question, and how far it got. */
export interface HoldAnswer {
  /** What the hold said when it was answered: a later hold differs. */
  signature: string;
  /** Firstmate cleared the hold after the answer was recorded. */
  cleared?: boolean;
  title: string;
  answer: string;
  at: string;
  /**
   * "sending" until the First Mate has taken it; "failed" with the reason;
   * "waiting" when the connection dropped and it is not known whether it
   * landed; "settled" when the hold was gone by the time Amun could check.
   */
  status: "sending" | "recorded" | "failed" | "waiting" | "settled";
  problem?: string;
  /** For a waiting answer: what to send once the connection is back. */
  resend?: { sent: string; until?: string };
}

/**
 * Captain holds from Firstmate, as question cards. A hold the owner has
 * answered moves to Done with the answer shown, so there is no doubt it was
 * taken; one whose answer did not reach Firstmate comes back open, saying so.
 */
export function holdAttention(
  view: DaemonView,
  now: string,
  answers: ReadonlyMap<string, HoldAnswer> = new Map(),
): WorkSnapshot["attention"] {
  const open = view.holds.map((hold) => {
    const id = holdId(hold);
    const answered = answers.get(id);
    const detail =
      hold.source === "crew"
        ? crewName(hold.taskId)
        : `${hold.taskId} · ${hold.reason}`;
    const done =
      answered && answered.status !== "failed" && answered.status !== "waiting";
    return {
      id,
      kind: "question" as const,
      groupId: null,
      workAreaId: null,
      title: hold.source === "crew" ? crewQuestion(hold.summary) : hold.title,
      detail: !answered
        ? detail
        : answered.status === "waiting"
          ? `Waiting to send: “${answered.answer}”. Amun checks with Firstmate when the connection is back, and sends it once if the question is unchanged.`
          : answered.status === "failed"
            ? `Your answer did not reach Firstmate (${answered.problem ?? "it could not be sent"}). Answer again. ${detail}`
            : `You answered: “${answered.answer}”. ${answered.status === "sending" ? "Firstmate is reading it." : "Firstmate has it."}`,
      state: done ? ("done" as const) : ("open" as const),
      ref: hold.taskId,
      options: [],
      answer: done ? answered.answer : null,
      createdAt: done ? answered.at : now,
    };
  });
  // Answered holds Firstmate has since cleared stay under Done for this run.
  const still = new Set(open.map((item) => item.id));
  const cleared = [...answers]
    .filter(
      ([id, answered]) =>
        !still.has(id) &&
        answered.status !== "failed" &&
        answered.status !== "waiting",
    )
    .map(([id, answered]) => ({
      id,
      kind: "question" as const,
      groupId: null,
      workAreaId: null,
      title: answered.title,
      detail:
        answered.status === "settled"
          ? `Already settled before your answer “${answered.answer}” could be sent. Check the request for what was recorded.`
          : `You answered: “${answered.answer}”. Firstmate has it.`,
      state: "done" as const,
      ref: null,
      options: [],
      answer: answered.answer,
      createdAt: answered.at,
    }));
  return [...open, ...cleared];
}

/**
 * Amun's work model with Firstmate laid over it: the First Mate and its crew
 * join the agents, and captain holds join the attention items. Model sign-in
 * now belongs to Pi, so the old first-run sign-in wizard never shows.
 */
export function toWorkSnapshot(
  view: DaemonView,
  now: string,
  answers: ReadonlyMap<string, HoldAnswer> = new Map(),
): WorkSnapshot {
  const base = workSnapshot.parse(view.work ?? EMPTY_WORK);
  const fleet = fleetAgents(view);
  const fleetRoles = new Set(fleet.map((agent) => agent.role.toLowerCase()));
  return workSnapshot.parse({
    ...base,
    setup: { ...base.setup, completed: true },
    agents: [
      ...fleet,
      ...base.agents.filter(
        (agent) =>
          agent.id !== FIRST_MATE_ID &&
          !fleetRoles.has(agent.role.toLowerCase()),
      ),
    ],
    attention: [...holdAttention(view, now, answers), ...base.attention],
  });
}

interface Conversation {
  sessionId: string;
  text: string;
  replyCount: number;
  latestReply?: string;
}

type Message = Record<string, unknown>;
/** Firstmate skills the First Mate runs when asked by name. */
const FIRSTMATE_SKILLS = new Set(["afk", "quiet", "ahoy", "bearings"]);
const NOTION_AUTH = new Set([
  "notion-connect",
  "notion-check",
  "notion-cancel",
  "notion-disconnect",
  "notion-target",
  "notion-status",
]);
const MEMORY_SYNC = new Set([
  "link-memory",
  "edit-memory-field",
  "sync-memory-field",
]);
/** Notion sign-in actions and linked-memory commands. */
function isNotionMessage(message: Message): boolean {
  const action = String(message.action);
  return (
    (message.kind === "auth" && NOTION_AUTH.has(action)) ||
    (message.kind === "workspace" && MEMORY_SYNC.has(action))
  );
}
const UNAVAILABLE = "Not available in this Amun build yet.";

/** Turns one renderer message into the replies the renderer expects. */
/** The First Mate's provider, shown where the UI expects a model id. */
export const FIRST_MATE_MODEL = "pi";

export class ContractAdapter {
  private view: DaemonView = { spaces: [], fleet: [], holds: [], work: null };
  /** One First Mate per home, so one conversation for every product. */
  private conversation: Conversation | null = null;
  /** The First Mate's model as the daemon last reported it. */
  private model: string | null = null;
  /** Held questions the owner has answered in this run. */
  private readonly holdAnswers = loadWaitingAnswers();
  /** Told when something changed without a request (an answer landed). */
  onChange: (() => void) | null = null;

  /** The owner's on-screen actions, on their way to Firstmate. */
  private readonly notices: NoticeQueue;

  constructor(
    private readonly daemon: AmunTransport,
    private readonly now: () => string = () => new Date().toISOString(),
    notices: NoticeOptions = {},
  ) {
    let storage = notices.keep;
    if (storage === undefined) {
      try {
        storage = globalThis.localStorage;
      } catch {
        storage = null;
      }
    }
    const navigation = new NavigationQueue(
      {
        activity: async (item, state) => {
          const events = await this.handleWork({
            version: 1,
            kind: "work",
            action: "navigation-activity",
            ref: item.ref,
            workAreaId: item.inspection.areaId ?? null,
            prompt: item.prompt,
            delivered: state === "finished",
          });
          if (
            !events.some(
              (e) => e && typeof e === "object" && "ok" in e && e.ok === true,
            )
          )
            throw Error("Could not record navigation.");
          this.onChange?.();
        },
        send: async (prompt, ref) => {
          const result = await this.daemon.request<{ delivered: boolean }>(
            "work.inspect",
            { space: await this.ensureSpace(), ref, prompt },
          );
          return result.delivered;
        },
      },
      storage ?? undefined,
    );
    navigation.install();
    this.daemon.onStatus((connected) => {
      if (connected) void navigation.flush();
    });
    this.notices = new NoticeQueue(
      async (text) => {
        const space = await this.ensureSpace();
        const answer = await this.daemon.request<{ reply?: string }>(
          "primary.send",
          { space, text },
        );
        return answer.reply ?? "";
      },
      (reply, told) => this.fileNoticeReply(reply, told),
      notices,
    );
  }

  /**
   * Firstmate had something to say about what the owner did on a screen. It
   * is kept in that work's conversation, or in the chats with no folder.
   */
  private async fileNoticeReply(
    reply: string,
    told: FirstmateNotice[],
  ): Promise<void> {
    const areas = this.view.work?.areas ?? [];
    const named = told.find(
      (notice) =>
        notice.workAreaId &&
        areas.some((area) => area.id === notice.workAreaId),
    )?.workAreaId;
    const workAreaId =
      named ??
      areas.find((area) => area.name === generalConversationName)?.id ??
      null;
    if (!workAreaId) return;
    await this.daemon.request("work.command", {
      command: {
        action: "message",
        workAreaId,
        role: "firstmate",
        text: reply.slice(0, 16384),
        model: this.model,
      },
    });
    await this.refresh().catch(() => undefined);
    this.onChange?.();
  }

  /** The First Mate needs a product to talk through; make the first one. */
  private async ensureSpace(): Promise<string> {
    const existing = activeSpace(this.view);
    if (existing) return existing;
    const space = await this.daemon.request<DaemonSpace>("spaces.create", {
      name: "Firstmate home",
      slug: "home",
    });
    this.view = { ...this.view, spaces: [space] };
    return space.slug;
  }

  private refreshSequence = 0;
  private appliedRefresh = 0;

  async refresh(): Promise<void> {
    const sequence = ++this.refreshSequence;
    const [spaces, work] = await Promise.all([
      this.daemon.request<DaemonSpace[]>("spaces.list"),
      this.daemon.request<WorkSnapshot>("work.snapshot"),
    ]);
    // Any product reaches the shared home; ask once.
    const via = spaces[0]?.slug;
    const [snapshot, everyHold] = via
      ? await Promise.all([
          this.daemon
            .request<{ tasks: DaemonFleetTask[] }>("fleet.snapshot", {
              space: via,
            })
            .catch(() => null),
          this.daemon
            .request<DaemonHold[]>("holds.list", { space: via })
            .catch(() => null),
        ])
      : [{ tasks: [] as DaemonFleetTask[] }, [] as DaemonHold[]];
    // A reminder put off to a later day stays away until that day.
    const workspace = await this.readWorkspace();
    if (sequence < this.appliedRefresh) return;
    this.appliedRefresh = sequence;
    const sameHome = via === this.view.spaces[0]?.slug;
    const holds = holdsDue(
      everyHold ?? (sameHome ? this.view.holds : []),
      this.now(),
    );
    this.view = {
      spaces,
      fleet: snapshot?.tasks ?? (sameHome ? this.view.fleet : []),
      holds,
      work,
      workspace,
    };
    if (everyHold) {
      settleHoldAnswers(this.holdAnswers, holds);
      this.resendWaitingAnswers(holds, via ?? null);
    }
    await this.ensureGroup();
  }

  /**
   * Once per home: Firstmate registers Amun's agents as its own second mates,
   * so it can route work to every one of them. Asked after the First Mate has
   * answered a message, which is when it is known to be working (the stored
   * setup flag is not used: the current first run never sets it).
   */
  private registerPool(space: string): void {
    if (this.poolAsked) return;
    this.poolAsked = true;
    void this.daemon
      .request("primary.once", {
        space,
        key: "register-agents-v1",
        text: poolRegistrationRequest(),
      })
      .catch(() => {
        this.poolAsked = false;
      });
    // The owner's rule for reminders, in their words, filed by Firstmate.
    void this.daemon
      .request("primary.once", {
        space,
        key: "draft-reminders-v1",
        text: draftingRule,
      })
      .catch(() => undefined);
    // The owner's Product Manager (`prd`) discovery charter and 20-point
    // coverage rule, collaborating with Research & Insights (`researcher`),
    // Product Marketing (`product-marketing`), and UX (`designer`).
    void this.daemon
      .request("primary.once", {
        space,
        key: "prd-discovery-charter-v1",
        text: prdDiscoveryCharterRule,
      })
      .catch(() => undefined);
  }
  private poolAsked = false;

  /**
   * The first-run wizard used to create the owner's groups; it no longer runs
   * (models sign in through Pi), so start with the "Work" group the owner uses.
   */
  private async ensureGroup(): Promise<void> {
    if (!this.view.work || this.view.work.groups.length > 0) return;
    const events = await this.daemon.request<Record<string, unknown>[]>(
      "work.command",
      { command: { action: "add-group", name: "Work" } },
    );
    const snapshot = events.find((event) => event.kind === "work-snapshot");
    if (snapshot)
      this.view = {
        ...this.view,
        work: snapshot as unknown as WorkSnapshot,
      };
  }

  workspace(): WorkspaceSnapshot {
    return this.view.workspace ?? toWorkspaceSnapshot(this.view);
  }

  private async readWorkspace(): Promise<WorkspaceSnapshot | null> {
    const raw = await this.daemon
      .request<unknown>("workspace.snapshot")
      .catch(() => null);
    const parsed = workspaceSnapshot.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  /** Product commands go to the daemon's workspace; the reply is a fresh snapshot. */
  private async handleWorkspace(message: Message): Promise<unknown[]> {
    const command = { ...message };
    delete command.version;
    delete command.kind;
    const result = await this.daemon
      .request<unknown>("workspace.command", { command })
      .catch((error: unknown) => ({
        version: 1,
        kind: "workspace-error",
        message: error instanceof Error ? error.message : String(error),
      }));
    this.view = { ...this.view, workspace: await this.readWorkspace() };
    const replies: unknown[] = [];
    if (
      result &&
      typeof result === "object" &&
      "kind" in result &&
      result.kind !== "workspace-snapshot"
    )
      replies.push(result);
    replies.push(this.workspace());
    return replies;
  }

  work(): WorkSnapshot {
    return toWorkSnapshot(this.view, this.now(), this.holdAnswers);
  }

  private result(
    action: string,
    ok: boolean,
    message: string,
    ref: string | null = null,
  ) {
    return {
      version: 1,
      kind: "work-result",
      action,
      ok,
      message,
      ref,
      step: null,
    };
  }

  async handle(message: Message): Promise<unknown[]> {
    if (message.method === "health")
      return [{ version: 1, id: message.id, status: "ready" }];
    if (isNotionMessage(message)) {
      // Notion runs in the daemon. What it knows at once comes back here;
      // a finished sign-in arrives later as a renderer event.
      const events = await this.daemon
        .request<unknown[]>("notion.request", { message })
        .catch(() => null);
      return (
        events ?? [
          this.notice("Amun could not reach Notion. Try again in a moment."),
        ]
      );
    }
    if (message.kind === "workspace" && message.action === "snapshot") {
      await this.refresh();
      return [this.workspace()];
    }
    if (message.kind === "product-authoring") {
      const { origin, ...input } = message;
      const ref = newRequestRef();
      const result = await this.daemon
        .request<unknown>("workspace.author", {
          space: await this.ensureSpace(),
          ref,
          message: input,
          origin,
        })
        .catch(() => ({
          version: 1,
          kind: "workspace-error",
          message:
            "Firstmate could not complete this draft. Reopen the PRD to check its saved state.",
        }));
      this.view = { ...this.view, workspace: await this.readWorkspace() };
      await this.refresh().catch(() => undefined);
      return [result, this.workspace(), this.work()];
    }
    if (message.kind === "workspace") return this.handleWorkspace(message);
    if (message.kind === "tracker-delivery") {
      // Read only: what this work area has in Jira and Linear now.
      const workAreaId = String(message.workAreaId ?? "");
      const empty = {
        version: 1,
        kind: "tracker-delivery-result",
        workAreaId,
        items: [],
        readAt: null,
        unread: [],
      };
      if (!workAreaId) return [empty];
      const reply = await this.daemon
        .request<Record<string, unknown>>("trackers.request", {
          message: { action: "delivery", workAreaId },
        })
        .catch(() => null);
      return [
        reply
          ? {
              ...empty,
              items: Array.isArray(reply.items) ? reply.items : [],
              readAt: typeof reply.readAt === "string" ? reply.readAt : null,
              unread: Array.isArray(reply.unread) ? reply.unread : [],
            }
          : empty,
      ];
    }
    if (message.kind === "backlog-read" || message.kind === "ado-operation") {
      const reply = await this.daemon
        .request<unknown>("ado.request", {
          message:
            message.action === "keep-observed-sprint" ||
            message.action === "suggest-sprint-stories" ||
            message.action === "apply-sprint-moves" ||
            message.action === "compare-prd" ||
            message.action === "approve-execute"
              ? { ...message, space: await this.ensureSpace() }
              : message,
        })
        .catch(() => null);
      if (message.action === "compare-prd") {
        this.view = { ...this.view, workspace: await this.readWorkspace() };
        return reply ? [reply, this.workspace()] : [];
      }
      if (
        reply &&
        (message.action === "apply-sprint-moves" ||
          message.action === "suggest-sprint-stories" ||
          message.action === "keep-observed-sprint" ||
          message.action === "inspect-sprint-submission")
      ) {
        await this.refresh().catch(() => undefined);
        return [reply, this.work()];
      }
      return reply ? [reply] : [];
    }
    if (message.kind === "council") {
      // The Council runs in the daemon; its replies are already in the
      // renderer's own shapes (a result, the work snapshot, the status).
      const events = await this.daemon
        .request<Record<string, unknown>[]>("council.request", { message })
        .catch(() => null);
      if (!events) return [];
      return events.map((event) => {
        if (event.kind !== "work-snapshot") return event;
        this.view = { ...this.view, work: event as unknown as WorkSnapshot };
        return this.work();
      });
    }
    if (message.kind === "tools") {
      // Looking for command-line tools happens in the daemon, on this Mac.
      const report = await this.daemon
        .request<unknown>("tools.request", { message })
        .catch(() => null);
      return report ? [report] : [];
    }
    if (message.kind === "work-attachment") {
      const file = workAttachment.parse(message);
      const header = {
        version: 1,
        kind: "work-attachment-result",
        requestId: file.requestId,
        name: file.name,
        portion: null,
      };
      try {
        if (file.bytes.length > 8 * 1024 * 1024)
          throw Error("Choose a file up to 8 MiB.");
        const pieces: string[] = [];
        for (let offset = 0; offset < file.bytes.length; offset += 16384)
          pieces.push(
            String.fromCharCode(...file.bytes.subarray(offset, offset + 16384)),
          );
        const saved = await this.daemon.request<{
          text: string;
          format: string;
          recordId: string;
        }>("work.attachment", {
          areaId: file.workAreaId,
          name: file.name,
          content: btoa(pieces.join("")),
        });
        void this.refresh()
          .then(() => this.onChange?.())
          .catch(() => undefined);
        return [{ ...header, ...saved, read: "all", note: null }];
      } catch (error) {
        return [
          {
            ...header,
            format: "",
            read: "none",
            text: "",
            recordId: null,
            note:
              error instanceof Error
                ? error.message
                : "Could not read this file.",
          },
        ];
      }
    }
    if (message.kind === "tracker-types")
      return [
        {
          version: 1,
          kind: "tracker-types-result",
          workAreaId: message.workAreaId,
          project: null,
          story: null,
          task: null,
          needs: [],
        },
      ];
    if (message.kind === "content-search") {
      // Read only: Amun's own store and Firstmate's saved steps.
      const found = await this.daemon
        .request<{
          hits: Record<string, unknown>[];
          steps: {
            stepId: string;
            workAreaId: string;
            words: string;
            script: string | null;
            at: string;
          }[];
        }>("work.search", { query: String(message.query ?? "") })
        .catch(() => ({ hits: [], steps: [] }));
      return [
        {
          version: 1,
          kind: "content-search-result",
          requestId: message.requestId,
          hits: [
            ...found.hits,
            ...found.steps.map((step) => ({
              kind: "step",
              id: step.stepId,
              title: step.words,
              snippet: [],
              workAreaId: step.workAreaId,
              role: "firstmate",
              at: step.at,
              script: step.script,
            })),
          ],
        },
      ];
    }
    if (message.kind === "what-happened") {
      const read = await this.daemon
        .request<{ available: boolean; turns: unknown[] }>("happened.read", {
          workAreaId: String(message.workAreaId ?? ""),
        })
        .catch(() => ({ available: false, turns: [] }));
      return [
        {
          version: 1,
          kind: "what-happened-result",
          requestId: message.requestId,
          available: read.available,
          turns: read.turns,
        },
      ];
    }
    if (message.kind === "auth") return this.handleAuth(message);
    if (message.kind === "work") {
      const { commandId, ...command } = message;
      const events = await this.handleWork(command);
      if (typeof commandId !== "string") return events;
      return events.map((event) =>
        event &&
        typeof event === "object" &&
        "kind" in event &&
        event.kind === "work-result"
          ? { ...event, commandId }
          : event,
      );
    }
    if (message.kind === "work-delegate") return this.delegate(message);
    if (message.kind === "native-pi" && message.action === "run")
      return [await this.handleNativePi(message)];
    if (message.kind === "diagnostics" && typeof message.id === "string")
      return [await this.traceBundle(message.id)];
    if (
      message.kind === "crew-list" ||
      message.kind === "refresh-crew" ||
      message.kind === "crew-observe" ||
      message.kind === "crew-session-read"
    )
      return this.handleCrew(message);
    if (message.kind === "plan-publish" && typeof message.planId === "string") {
      // "Check now" or "Retry" on a Linear or Jira plan the captain approved.
      // The daemon publishes only within that approval; other plans are not
      // its to publish, and nothing changes for them.
      const reply = await this.daemon
        .request<{ handled?: boolean }>("trackers.request", {
          message: {
            action: "publish",
            planId: message.planId,
            ...(message.retry === true ? { retry: true } : {}),
          },
        })
        .catch(() => null);
      if (!reply?.handled) return [];
      await this.refresh().catch(() => undefined);
      return [this.work()];
    }
    return [];
  }

  /**
   * Watching a crewmate is read-only: the roster comes from Firstmate's fleet
   * snapshot and the live session from fm-peek.sh, through the daemon.
   */
  private async handleCrew(message: Message): Promise<unknown[]> {
    if (message.kind === "crew-list" || message.kind === "refresh-crew") {
      const ok = await this.refresh().then(
        () => true,
        () => false,
      );
      const members = ok
        ? this.view.fleet.map((task) => ({
            id: task.id,
            state: task.current_state?.state ?? "unknown",
            current: task.current_state?.detail || null,
            endpoint: "unknown" as const,
            access: null,
            decisions: [],
            next: [],
            history: task.hints?.last_event_text
              ? [task.hints.last_event_text]
              : [],
          }))
        : null;
      return [
        { kind: "crew-roster", members },
        {
          version: 1,
          kind: "crew-inventory",
          tasks: members ? members.map((member) => member.id) : null,
        },
      ];
    }
    const taskId = String(message.taskId ?? "");
    if (message.kind === "crew-observe")
      return [
        {
          version: 1,
          kind: "crew-observation",
          taskId,
          endpoint: "unknown",
          worker: "unknown",
        },
      ];
    const space = await this.ensureSpace();
    const peek = await this.daemon
      .request<{ live: boolean; text: string }>("crew.peek", { space, taskId })
      .catch(() => ({ live: false, text: "" }));
    return [
      {
        version: 1,
        kind: "crew-session-text",
        taskId,
        live: peek.live,
        text: peek.text.slice(-32768),
      },
    ];
  }

  /**
   * Diagnostics are the trace bundle. The first export also asks the First
   * Mate, once, to keep agent history; Amun never writes those flags itself.
   */
  private async traceBundle(id: string) {
    try {
      const space = await this.ensureSpace();
      const history = await this.daemon
        .request<{ asked: boolean; ledger: boolean; archive: boolean }>(
          "trace.history",
          { space },
        )
        .catch(() => null);
      const bundle = await this.daemon.request<{
        fileName: string;
        size: number;
        files: string[];
        base64: string;
      }>("trace.export", { space });
      return {
        version: 1,
        kind: "trace-bundle",
        id,
        fileName: bundle.fileName,
        size: bundle.size,
        files: bundle.files,
        base64: bundle.base64,
        history:
          history?.ledger && history.archive
            ? "on"
            : history?.asked
              ? "asked"
              : "off",
      };
    } catch (error) {
      return {
        version: 1,
        kind: "trace-bundle-failed",
        id,
        message: (error instanceof Error ? error.message : String(error)).slice(
          0,
          4096,
        ),
      };
    }
  }

  private connectionCheck = new Map<string, Promise<DaemonConnection>>();

  private async authConnections(verifySaved = false) {
    const list = await this.daemon
      .request<DaemonConnection[]>("connections.list")
      .catch(() => [] as DaemonConnection[]);
    const verified = verifySaved
      ? await Promise.all(
          list.map((item) => {
            if (item.kind !== "ado" || item.status !== "configured")
              return item;
            const pending = this.connectionCheck.get(item.id);
            if (pending) return pending;
            const check = this.daemon
              .request<DaemonConnection>("connections.check", {
                connection: { kind: item.kind, baseUrl: item.baseUrl },
              })
              .catch(() => ({ ...item, status: "unknown" }))
              .finally(() => {
                this.connectionCheck.delete(item.id);
              });
            this.connectionCheck.set(item.id, check);
            return check;
          }),
        )
      : list;
    return {
      version: 1,
      kind: "auth-connections",
      connections: verified.map(({ kind, baseUrl, id, status }) => ({
        kind,
        baseUrl,
        id,
        status,
      })),
    };
  }

  /**
   * Model sign-ins live in Pi. Amun asks Pi whether a provider is ready and
   * reports it the way the sign-in cards expect: "checking" then "configured"
   * for a stored sign-in (shown as "Signed in"), never the credential.
   */
  private async accountStatus(provider: string): Promise<unknown[]> {
    const status = (value: string) => ({
      version: 1,
      kind: "auth-status",
      id: provider,
      status: value,
    });
    const check = await this.daemon
      .request<{ status: "ready" | "missing" | "error" }>("accounts.check", {
        provider,
      })
      .catch(() => null);
    if (!check) return [status("unknown")];
    if (check.status === "ready")
      return [status("checking"), status("configured")];
    return [status(check.status)];
  }

  /** The model the First Mate is on and the ones Pi offers, from the daemon. */
  private async models(): Promise<{
    current: string | null;
    models: { id: string; label: string }[];
  }> {
    if (this.view.spaces.length === 0) await this.refresh();
    const space = await this.ensureSpace();
    const listed = await this.daemon.request<{
      current: string | null;
      models: { id: string; label: string }[];
    }>("models.list", { space });
    this.model = listed.current;
    return listed;
  }

  private notice(text: string) {
    return { version: 1, kind: "auth-notice", message: text.slice(0, 4096) };
  }

  /** Connections: Azure DevOps through the daemon (token kept in Keychain). */
  private async handleAuth(message: Message): Promise<unknown[]> {
    const action = String(message.action);
    if (
      action.startsWith("tracker-") &&
      (message.provider === "jira" || message.provider === "linear")
    )
      return this.trackerCard(action, message.provider, message.browser);
    if (action === "list") return [await this.authConnections(true)];
    if (action === "readiness")
      return this.accountStatus(String(message.provider));
    if (action === "login")
      return [
        this.notice(
          "Signing in from Amun is not ready yet. Open Pi in Terminal, type /login and choose this provider, then open this page again.",
        ),
        ...(await this.accountStatus(String(message.provider))),
      ];
    if (action !== "save" && action !== "check" && action !== "forget")
      return [this.notice(UNAVAILABLE)];
    const connection = message.connection as
      { kind?: unknown; baseUrl?: unknown } | undefined;
    if (connection?.kind === "linear" || connection?.kind === "jira")
      return this.trackerAuth(action, connection.kind);
    if (connection?.kind !== "ado")
      return [
        this.notice(
          "Only Azure DevOps connects in this Amun build so far. The others are coming one by one.",
        ),
        await this.authConnections(),
      ];
    try {
      if (action === "forget") {
        await this.daemon.request("connections.forget", { connection });
        return [
          this.notice("Azure DevOps disconnected and its token removed."),
          await this.authConnections(),
        ];
      }
      const view = await this.daemon.request<DaemonConnection>(
        action === "save" ? "connections.save" : "connections.check",
        action === "save"
          ? { connection, secret: message.secret }
          : { connection },
      );
      return [this.notice(describeAdo(view)), await this.authConnections()];
    } catch (error) {
      return [
        this.notice(error instanceof Error ? error.message : String(error)),
        await this.authConnections(),
      ];
    }
  }

  /**
   * The Jira and Linear cards in Settings › Tools. A finished browser sign-in
   * arrives later from the daemon as an "auth-status" renderer event.
   */
  private async trackerCard(
    action: string,
    provider: "jira" | "linear",
    browser: unknown,
  ): Promise<unknown[]> {
    const name = provider === "jira" ? "Jira" : "Linear";
    const daemonAction = {
      "tracker-connect": "connect",
      "tracker-check": "check",
      "tracker-cancel": "cancel",
      "tracker-disconnect": "disconnect",
      "tracker-status": "status",
    }[action];
    if (!daemonAction) return [this.notice(UNAVAILABLE)];
    try {
      const status = await this.daemon.request<TrackerStatus>(
        "trackers.request",
        {
          message: {
            action: daemonAction,
            provider,
            ...(daemonAction === "connect"
              ? { browser: browser === "dia" ? "dia" : "edge" }
              : {}),
          },
        },
      );
      const event = trackerStatusEvent(provider, status);
      if (daemonAction === "disconnect")
        return [
          event,
          this.notice(
            `${name} disconnected. Its saved sign-in was removed from this Mac. Items already published stay in ${name}.`,
          ),
        ];
      return status.status === "error" || status.status === "missing"
        ? daemonAction === "status"
          ? [event]
          : [event, this.notice(status.message ?? `${name} is not connected.`)]
        : [event];
    } catch {
      return [
        trackerStatusEvent(provider, { status: "error" }),
        this.notice(`Amun could not reach ${name}. Try again in a moment.`),
      ];
    }
  }

  /**
   * Linear and Jira sign in through each provider's hosted MCP server in the
   * browser; the grant stays in the daemon's Keychain. A finished sign-in
   * arrives later as a renderer event ("auth-status").
   */
  private async trackerAuth(
    action: string,
    provider: "linear" | "jira",
  ): Promise<unknown[]> {
    const name = provider === "linear" ? "Linear" : "Jira";
    const daemonAction =
      action === "save"
        ? "connect"
        : action === "forget"
          ? "disconnect"
          : "check";
    try {
      const status = await this.daemon.request<{
        status?: string;
        message?: string | null;
      }>("trackers.request", { message: { action: daemonAction, provider } });
      const said =
        daemonAction === "disconnect"
          ? `${name} disconnected and its sign-in removed from this Mac.`
          : status.status === "checking"
            ? `Finish signing in to ${name} in your browser.`
            : status.status === "ready"
              ? `${name} is connected.`
              : (status.message ?? `${name} is not connected.`);
      return [
        this.notice(said),
        { version: 1, kind: "tracker-status", provider, ...status },
      ];
    } catch {
      return [
        this.notice(`Amun could not reach ${name}. Try again in a moment.`),
      ];
    }
  }

  private async handleWork(message: Message): Promise<unknown[]> {
    const action = String(message.action);
    try {
      if (action === "draft-blocker-message") {
        const snapshot = await this.daemon.request<WorkSnapshot>("work.nudge", {
          command: message,
          space: await this.ensureSpace(),
        });
        this.view = { ...this.view, work: snapshot };
        return [
          this.result(action, true, "Draft request checked."),
          this.work(),
        ];
      }
      if (action === "snapshot") {
        await this.refresh();
        return [this.work()];
      }
      if (
        action === "resolve-attention" &&
        String(message.attentionId).startsWith("hold:")
      )
        return await this.answerHold(message);
      // Team changes are requests to the First Mate; the pool card is Amun's.
      const ask = this.teamAsk(message);
      if (action === "edit-agent") {
        if (!ask) return [this.result(action, false, "That agent is gone.")];
        await this.askFirstMate(ask);
        return [this.result(action, true, "Sent to Firstmate.")];
      }
      // Everything else is Amun's own work model, kept by the daemon.
      const command = { ...message };
      delete command.version;
      delete command.kind;
      // `told` only says whether Firstmate already knows; it is never stored.
      const told = command.told === true;
      delete command.told;
      const before = this.view.work ?? null;
      const events = await this.daemon.request<Record<string, unknown>[]>(
        "work.command",
        { command },
      );
      if (ask) await this.askFirstMate(ask).catch(() => undefined);
      const sent = events.map((event) => {
        if (event.kind !== "work-snapshot") return event;
        this.view = { ...this.view, work: event as unknown as WorkSnapshot };
        return this.work();
      });
      if (!told) this.tellFirstmate(message, before, events);
      return sent;
    } catch (error) {
      return [
        this.result(
          action,
          false,
          error instanceof Error ? error.message : String(error),
        ),
      ];
    }
  }

  /**
   * The owner did this on a screen: Firstmate is told what was done and what
   * the card held, in the background (owner's rule, 20 November 2026). Which
   * actions are told is decided in `firstmate-notice.ts`.
   */
  private tellFirstmate(
    message: Message,
    before: WorkSnapshot | null,
    events: Record<string, unknown>[],
  ): void {
    const result = events.find((event) => event.kind === "work-result");
    if (result?.ok === false) return;
    const rest = { ...message };
    delete rest.told;
    const parsed = workCommand.safeParse(rest);
    if (!parsed.success) return;
    const notice = firstmateNotice(parsed.data, {
      before,
      after: this.view.work ?? null,
      ref: typeof result?.ref === "string" ? result.ref : null,
    });
    if (notice) this.notices.add(notice);
  }

  private agentRole(agentId: string): string | null {
    if (agentId.startsWith("catalog:")) return agentId.slice(8);
    const agents = [
      ...fleetAgents(this.view),
      ...(this.view.work?.agents ?? []),
    ];
    return agents.find((agent) => agent.id === agentId)?.role ?? null;
  }

  private teamAsk(message: Message): string | null {
    const action = String(message.action);
    if (action === "add-agent" && typeof message.description === "string")
      return teamRequest("add", message.description.trim());
    if (action === "toggle-agent" || action === "edit-agent") {
      const role = this.agentRole(String(message.agentId));
      if (!role) return null;
      if (action === "edit-agent")
        return teamRequest("edit", role, String(message.change ?? ""));
      return teamRequest(message.enabled ? "add" : "retire", role);
    }
    return null;
  }

  /**
   * A conversation handed a job to an agent. It goes to the First Mate, who
   * dispatches it through Firstmate; what it says back is kept in the same
   * conversation. Nothing is started here.
   */
  private delegate(message: Message): unknown[] {
    const parsed = workDelegate.safeParse(message);
    if (!parsed.success) return [];
    const job = parsed.data;
    const say = (text: string) =>
      this.daemon.request("work.command", {
        command: {
          action: "message",
          workAreaId: job.workAreaId,
          role: "firstmate",
          text: text.slice(0, 16384),
          model: this.model,
        },
      });
    void this.ensureSpace()
      .then((space) =>
        this.daemon.request<{ reply?: string }>("primary.send", {
          space,
          text: delegationRequest(job),
        }),
      )
      .then(
        (answer) => {
          const reply = (answer.reply ?? "").trim();
          return reply ? say(reply) : undefined;
        },
        (error: unknown) =>
          say(
            `I could not hand “${job.title}” to ${job.agent}: ${error instanceof Error ? error.message : String(error)} Ask me again when I am free.`,
          ),
      )
      .catch(() => undefined)
      .then(() => this.refresh().catch(() => undefined))
      .then(() => this.onChange?.());
    return [];
  }

  private async askFirstMate(text: string): Promise<void> {
    const space = await this.ensureSpace();
    await this.daemon.request("primary.send", { space, text });
  }

  private async answerHold(message: Message): Promise<unknown[]> {
    const action = "resolve-attention";
    const found = this.findHold(String(message.attentionId));
    if (!found)
      return [this.result(action, false, "That hold is no longer open.")];
    // Done and "Remind me later" are the owner's answers too, said for them:
    // Firstmate is asked to close the task, or to put it off to that day.
    const until =
      typeof message.until === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(message.until)
        ? message.until
        : undefined;
    const said =
      message.resolution === "done"
        ? { shown: heldOutcome("done"), sent: heldInstruction("done") }
        : message.resolution === "snooze" && until
          ? {
              shown: heldOutcome("snooze", until),
              sent: heldInstruction("snooze", until),
            }
          : message.resolution === "answer" &&
              typeof message.answer === "string"
            ? { shown: message.answer, sent: message.answer }
            : null;
    if (!said)
      return [
        this.result(
          action,
          false,
          "Firstmate keeps this one. Answer it, mark it done, or choose a day to be reminded.",
        ),
      ];
    const id = holdId(found);
    // One answer per question: a second click, or a retry while the first is
    // still on its way or waiting for the connection, sends nothing more.
    const earlier = this.holdAnswers.get(id);
    if (
      earlier &&
      (earlier.status === "sending" || earlier.status === "waiting") &&
      earlier.signature === holdSignature(found)
    )
      return [
        this.result(action, true, `Already sent: “${earlier.answer}”.`),
        this.work(),
      ];
    const answered: HoldAnswer = {
      signature: holdSignature(found),
      title:
        found.source === "crew" ? crewQuestion(found.summary) : found.title,
      answer: said.shown,
      at: this.now(),
      status: "sending",
    };
    this.holdAnswers.set(id, answered);
    // Firstmate takes the answer as a turn, which can wait behind another.
    // The owner sees at once that it was taken, and later whether it landed.
    void this.ensureSpace()
      .then((space) =>
        this.daemon.request("holds.answer", {
          space,
          hold: found,
          answer: said.sent,
          ...(message.resolution === "snooze" && until ? { until } : {}),
        }),
      )
      .then(
        () => {
          this.holdAnswers.set(id, { ...answered, status: "recorded" });
        },
        (error: unknown) => {
          // The connection dropped: whether it landed is unknown, so it waits
          // and is checked against Firstmate's holds before any retry.
          const interrupted =
            error instanceof AmunRequestError &&
            error.error.code === "interrupted";
          this.holdAnswers.set(id, {
            ...answered,
            status: interrupted ? "waiting" : "failed",
            problem: error instanceof Error ? error.message : String(error),
            ...(interrupted
              ? {
                  resend: {
                    sent: said.sent,
                    ...(message.resolution === "snooze" && until
                      ? { until }
                      : {}),
                  },
                }
              : {}),
          });
          if (interrupted) this.saveWaitingAnswers();
        },
      )
      .then(() => this.refresh().catch(() => undefined))
      .then(() => this.onChange?.());
    return [
      this.result(
        action,
        true,
        `Sent to Firstmate: “${said.shown}”. It is under Done.`,
      ),
      this.work(),
    ];
  }

  /**
   * Answers that waited out a dropped connection, now that the holds are
   * known again: one still open and unchanged is sent once more; the rest
   * were settled or changed (see settleHoldAnswers).
   */
  private resendWaitingAnswers(
    holds: readonly DaemonHold[],
    space: string | null,
  ) {
    if (!space) return;
    for (const [id, answered] of this.holdAnswers) {
      if (answered.status !== "waiting" || !answered.resend) continue;
      const hold = holds.find((item) => holdId(item) === id);
      if (!hold || holdSignature(hold) !== answered.signature) continue;
      const again: HoldAnswer = { ...answered, status: "sending" };
      this.holdAnswers.set(id, again);
      void this.daemon
        .request("holds.answer", {
          space,
          hold,
          answer: answered.resend.sent,
          ...(answered.resend.until ? { until: answered.resend.until } : {}),
        })
        .then(
          () => this.holdAnswers.set(id, { ...again, status: "recorded" }),
          (error: unknown) =>
            this.holdAnswers.set(id, {
              ...again,
              status:
                error instanceof AmunRequestError &&
                error.error.code === "interrupted"
                  ? "waiting"
                  : "failed",
              problem: error instanceof Error ? error.message : String(error),
            }),
        )
        .then(() => {
          this.saveWaitingAnswers();
          this.onChange?.();
        });
    }
    this.saveWaitingAnswers();
  }
  /** Waiting answers survive a restart of Amun. */
  private saveWaitingAnswers() {
    try {
      const waiting = Object.fromEntries(
        [...this.holdAnswers].filter(
          ([, answered]) => answered.status === "waiting",
        ),
      );
      localStorage.setItem(waitingAnswersKey, JSON.stringify(waiting));
    } catch {
      // Kept in memory for this run.
    }
  }

  private findHold(attentionId: string): DaemonHold | null {
    return (
      this.view.holds.find((candidate) => holdId(candidate) === attentionId) ??
      null
    );
  }

  private conversationResult(conversation: Conversation) {
    return {
      kind: "conversation",
      calm: true,
      // The model Pi is on; "pi" until the daemon has said which, because the
      // UI only sends once it knows a model is there.
      model: this.model ?? FIRST_MATE_MODEL,
      sessionId: conversation.sessionId,
      title: "First Mate",
      text: conversation.text,
      omittedItems: 0,
      replyCount: conversation.replyCount,
      ...(conversation.latestReply
        ? { latestReply: conversation.latestReply }
        : {}),
    };
  }

  private async handleNativePi(message: Message) {
    const reply = (result: unknown) => ({
      version: 1,
      kind: "native-pi-result",
      id: message.id,
      result,
    });
    const fail = (text: string) => reply({ kind: "message", text });
    const command = String(message.command);
    if (command === "default-model" || command === "model") {
      try {
        const argument = String(message.argument ?? "").trim();
        if (command === "default-model")
          return reply({
            kind: "message",
            text: JSON.stringify({ model: (await this.models()).current }),
          });
        if (!argument)
          return reply({
            kind: "choices",
            title: "Choose a model",
            choices: (await this.models()).models.slice(0, 2048),
          });
        const space = await this.ensureSpace();
        const chosen = await this.daemon.request<{ model: string }>(
          "primary.setModel",
          { space, model: argument },
        );
        this.model = chosen.model;
        // The picker looks for the id it asked for in this line.
        return reply({
          kind: "message",
          text: `Firstmate now uses ${argument}.`,
        });
      } catch (error) {
        // The picker reads a reply without the model id as "not selected".
        return fail(
          command === "model" && String(message.argument ?? "").trim()
            ? "That model could not be selected."
            : error instanceof Error
              ? error.message
              : String(error),
        );
      }
    }
    if (FIRSTMATE_SKILLS.has(command)) {
      // Firstmate's own skills. Pi expands "/skill:name" in a message, so the
      // First Mate runs the skill itself; Amun only passes the words on.
      try {
        if (this.view.spaces.length === 0) await this.refresh();
        const space = await this.ensureSpace();
        const argument = String(message.argument ?? "").trim();
        const answer = await this.daemon.request<{ reply?: string }>(
          "primary.send",
          {
            space,
            text: `/skill:${command}${argument ? " " + argument : ""}`,
          },
        );
        return fail((answer.reply ?? "").trim() || "Done.");
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    }
    if (command === "updatefirstmate")
      return fail(
        "Updating Firstmate from inside Amun is switched off. An update is tested as a separate candidate first, and only then approved by you.",
      );
    // The captain decided on 19 November 2026 that Amun does not offer /stow.
    // It is still caught here so the words never reach the First Mate, where
    // the skill would run on a hosted model.
    if (command === "stow")
      return fail(
        "Amun does not save session notes to Firstmate’s memory. Firstmate keeps its own memory as it works.",
      );
    // /calm hides tool chatter in Pi's terminal screen. Amun has no terminal
    // and only ever shows the calm view.
    if (command === "calm") return fail("Amun already shows the calm view.");
    if (command === "supervision-model") {
      // Firstmate owns this setting, so the choice goes to the First Mate as
      // a request; Amun never writes Firstmate's config itself.
      const argument = String(message.argument ?? "").trim();
      const usage =
        "To choose the model Firstmate uses to supervise the crew, type `/supervision-model` and part of a name, for example `/supervision-model sonnet`. To use the same model as your conversation, type `/supervision-model follow main`.";
      if (!argument) return fail(usage);
      try {
        let request: string;
        if (/^follow(\s+main)?$/i.test(argument))
          request =
            "The captain asked that the supervision branch follow the main conversation's model again. Please remove the pin in config/supervision-branch-model (see docs/configuration.md), and tell the captain in one line whether it is done.";
        else {
          const picked = pickByName((await this.models()).models, argument);
          if ("none" in picked)
            return fail(`No model matches “${argument}”. ${usage}`);
          if ("several" in picked)
            return fail(
              `Several models match “${argument}”: ${picked.several
                .slice(0, 8)
                .map((item) => item.label)
                .join(", ")}. Type more of the name.`,
            );
          request = `The captain chose ${picked.one.id} as the model for the supervision branch. Please save it as the pin in config/supervision-branch-model, in the format docs/configuration.md describes, and tell the captain in one line whether it is saved.`;
        }
        const space = await this.ensureSpace();
        const answer = await this.daemon.request<{ reply?: string }>(
          "primary.send",
          { space, text: request },
        );
        return fail(
          (answer.reply ?? "").trim() || "Firstmate has the request.",
        );
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
      }
    }
    if (command !== "conversation" && command !== "conversation-send")
      return fail(UNAVAILABLE);
    try {
      if (this.view.spaces.length === 0) await this.refresh();
      const space = await this.ensureSpace();
      let conversation = this.conversation;
      if (!conversation) {
        await this.daemon.request("primary.start", { space });
        // Model discovery belongs to the picker. A slow catalog must not hold a chat turn.
        conversation = {
          sessionId: crypto.randomUUID(),
          text: "",
          replyCount: 0,
        };
        this.conversation = conversation;
      }
      if (command === "conversation-send") {
        const argument = JSON.parse(String(message.argument)) as {
          text?: unknown;
        };
        if (typeof argument.text !== "string" || !argument.text.trim())
          return fail("Type a message for the First Mate.");
        const answer = await this.daemon.request<{
          reply?: string;
          finalText?: string;
          followups?: string[];
        }>("primary.send", {
          space,
          text: argument.text,
          collectFollowups: true,
        });
        const latest = (answer.reply ?? answer.finalText ?? "").trim();
        conversation.text += `${conversation.text ? "\n\n" : ""}You: ${argument.text}\n\nFirst Mate: ${latest}`;
        conversation.replyCount += 1;
        conversation.latestReply = latest;
        this.registerPool(space);
        return reply({
          ...this.conversationResult(conversation),
          followups: answer.followups,
        });
      }
      return reply(this.conversationResult(conversation));
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }
}
