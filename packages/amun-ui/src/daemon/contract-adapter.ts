// Answers the renderer's existing port contracts (@amun/contracts) from the
// daemon's /amun RPC, so every screen keeps its current shape. Products become
// products and groups. Every product shares the captain's one Firstmate home,
// so the fleet (agents), captain holds (attention) and the First Mate chat are
// home-wide and appear once, not once per product.
import { workspaceSnapshot, type WorkspaceSnapshot } from "@amun/contracts";
import {
  workSnapshot,
  type WorkSnapshot,
} from "../../../contracts/src/work.ts";
import type { AmunTransport } from "./amun-client.ts";
import { agentCatalog } from "../../../domain/src/work/agents.ts";

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** A secondmate whose id names a pool specialist shows on that card. */
export function poolRole(taskId: string): string | null {
  const id = slug(taskId);
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
  kind: "ado" | "github" | "notion" | "obsidian";
  baseUrl: string;
  status: string;
  user: string | null;
  projects: { id: string; name: string }[];
  message: string | null;
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
      role:
        poolRole(task.id) ??
        (task.kind ? `${task.kind} · ${task.id}` : task.id),
      kind: "temporary",
      launcherId: FIRST_MATE_ID,
      state: agentState(task),
      nowDoing: task.current_state?.detail || null,
      output: task.hints?.last_event_text ?? "",
      enabled: true,
    });
  }
  return agents;
}

/** Captain holds from Firstmate, as question cards. */
export function holdAttention(
  view: DaemonView,
  now: string,
): WorkSnapshot["attention"] {
  return view.holds.map((hold) => ({
    id: holdId(hold),
    kind: "question" as const,
    groupId: null,
    workAreaId: null,
    title: hold.source === "crew" ? hold.summary : hold.title,
    detail:
      hold.source === "crew"
        ? `${hold.taskId} · ${hold.verb}`
        : `${hold.taskId} · ${hold.reason}`,
    state: "open" as const,
    ref: hold.taskId,
    options: [],
    answer: null,
    createdAt: now,
  }));
}

/**
 * Amun's work model with Firstmate laid over it: the First Mate and its crew
 * join the agents, and captain holds join the attention items. Model sign-in
 * now belongs to Pi, so the old first-run sign-in wizard never shows.
 */
export function toWorkSnapshot(view: DaemonView, now: string): WorkSnapshot {
  const base = workSnapshot.parse(view.work ?? EMPTY_WORK);
  return workSnapshot.parse({
    ...base,
    setup: { ...base.setup, completed: true },
    agents: [
      ...fleetAgents(view),
      ...base.agents.filter((agent) => agent.id !== FIRST_MATE_ID),
    ],
    attention: [...holdAttention(view, now), ...base.attention],
  });
}

interface Conversation {
  sessionId: string;
  text: string;
  replyCount: number;
  latestReply?: string;
}

type Message = Record<string, unknown>;
const UNAVAILABLE = "Not available in this Amun build yet.";

/** Turns one renderer message into the replies the renderer expects. */
/** The First Mate's provider, shown where the UI expects a model id. */
export const FIRST_MATE_MODEL = "pi";

export class ContractAdapter {
  private view: DaemonView = { spaces: [], fleet: [], holds: [], work: null };
  /** One First Mate per home, so one conversation for every product. */
  private conversation: Conversation | null = null;

  constructor(
    private readonly daemon: AmunTransport,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

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

  async refresh(): Promise<void> {
    const [spaces, work] = await Promise.all([
      this.daemon.request<DaemonSpace[]>("spaces.list"),
      this.daemon.request<WorkSnapshot>("work.snapshot"),
    ]);
    // Any product reaches the shared home; ask once.
    const via = spaces[0]?.slug;
    const [snapshot, holds] = via
      ? await Promise.all([
          this.daemon
            .request<{ tasks: DaemonFleetTask[] }>("fleet.snapshot", {
              space: via,
            })
            .catch(() => ({ tasks: [] as DaemonFleetTask[] })),
          this.daemon
            .request<DaemonHold[]>("holds.list", { space: via })
            .catch(() => [] as DaemonHold[]),
        ])
      : [{ tasks: [] as DaemonFleetTask[] }, [] as DaemonHold[]];
    this.view = {
      spaces,
      fleet: snapshot.tasks,
      holds,
      work,
      workspace: await this.readWorkspace(),
    };
    await this.ensureGroup();
  }

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
    return toWorkSnapshot(this.view, this.now());
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
    if (message.kind === "workspace" && message.action === "snapshot") {
      await this.refresh();
      return [this.workspace()];
    }
    if (message.kind === "workspace") return this.handleWorkspace(message);
    if (message.kind === "backlog-read" || message.kind === "ado-operation") {
      const reply = await this.daemon
        .request<unknown>("ado.request", { message })
        .catch(() => null);
      return reply ? [reply] : [];
    }
    if (message.kind === "auth") return this.handleAuth(message);
    if (message.kind === "work") return this.handleWork(message);
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

  private async authConnections() {
    const list = await this.daemon
      .request<DaemonConnection[]>("connections.list")
      .catch(() => [] as DaemonConnection[]);
    return {
      version: 1,
      kind: "auth-connections",
      connections: list.map(({ kind, baseUrl, id, status }) => ({
        kind,
        baseUrl,
        id,
        status,
      })),
    };
  }

  private notice(text: string) {
    return { version: 1, kind: "auth-notice", message: text.slice(0, 4096) };
  }

  /** Connections: Azure DevOps through the daemon (token kept in Keychain). */
  private async handleAuth(message: Message): Promise<unknown[]> {
    const action = String(message.action);
    if (action === "list") return [await this.authConnections()];
    if (action !== "save" && action !== "check" && action !== "forget")
      return [this.notice(UNAVAILABLE)];
    const connection = message.connection as
      { kind?: unknown; baseUrl?: unknown } | undefined;
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

  private async handleWork(message: Message): Promise<unknown[]> {
    const action = String(message.action);
    try {
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
      const events = await this.daemon.request<Record<string, unknown>[]>(
        "work.command",
        { command },
      );
      if (ask) await this.askFirstMate(ask).catch(() => undefined);
      return events.map((event) => {
        if (event.kind !== "work-snapshot") return event;
        this.view = { ...this.view, work: event as unknown as WorkSnapshot };
        return this.work();
      });
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

  private async askFirstMate(text: string): Promise<void> {
    const space = await this.ensureSpace();
    await this.daemon.request("primary.send", { space, text });
  }

  private async answerHold(message: Message): Promise<unknown[]> {
    const action = "resolve-attention";
    const found = this.findHold(String(message.attentionId));
    if (!found)
      return [this.result(action, false, "That hold is no longer open.")];
    if (message.resolution !== "answer" || typeof message.answer !== "string")
      return [
        this.result(action, false, "Answer the First Mate to clear this hold."),
      ];
    const space = await this.ensureSpace();
    await this.daemon.request("holds.answer", {
      space,
      hold: found,
      answer: message.answer,
    });
    await this.refresh();
    return [this.result(action, true, "Sent to the First Mate."), this.work()];
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
      // Pi runs the First Mate and picks its own model; the UI only needs to
      // know one is there before it sends.
      model: FIRST_MATE_MODEL,
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
    if (command !== "conversation" && command !== "conversation-send")
      return fail(UNAVAILABLE);
    try {
      if (this.view.spaces.length === 0) await this.refresh();
      const space = await this.ensureSpace();
      let conversation = this.conversation;
      if (!conversation) {
        await this.daemon.request("primary.start", { space });
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
        }>("primary.send", { space, text: argument.text });
        const latest = (answer.reply ?? answer.finalText ?? "").trim();
        conversation.text += `${conversation.text ? "\n\n" : ""}You: ${argument.text}\n\nFirst Mate: ${latest}`;
        conversation.replyCount += 1;
        conversation.latestReply = latest;
      }
      return reply(this.conversationResult(conversation));
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }
}
