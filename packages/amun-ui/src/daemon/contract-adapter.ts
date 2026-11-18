// Answers the renderer's existing port contracts (@amun/contracts) from the
// daemon's /amun RPC, so every screen keeps its current shape. Products become
// products and groups. Every product shares the captain's one Firstmate home,
// so the fleet (agents), captain holds (attention) and the First Mate chat are
// home-wide and appear once, not once per product.
import { workspaceSnapshot, type WorkspaceSnapshot } from "@amun/contracts";
import {
  setupState,
  workSnapshot,
  type SetupState,
  type WorkSnapshot,
} from "../../../contracts/src/work.ts";
import type { AmunTransport } from "./amun-client.ts";

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
  fleet: DaemonFleetTask[];
  holds: DaemonHold[];
}

export interface SetupStore {
  load(): SetupState;
  save(setup: SetupState): void;
}

export function memorySetupStore(
  initial: Partial<SetupState> = {},
): SetupStore {
  let value = setupState.parse({ completed: true, ...initial });
  return { load: () => value, save: (next) => void (value = next) };
}

export function localSetupStore(
  storage: Storage = window.localStorage,
): SetupStore {
  const key = "amun.daemon.setup";
  return {
    load() {
      try {
        const raw = storage.getItem(key);
        if (raw) return setupState.parse(JSON.parse(raw));
      } catch {
        // A broken saved value falls back to the defaults below.
      }
      return setupState.parse({ completed: true });
    },
    save: (setup) => storage.setItem(key, JSON.stringify(setup)),
  };
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

export function activeSpace(
  view: DaemonView,
  setup: SetupState,
): string | null {
  const chosen = setup.activeGroupId;
  if (chosen && view.spaces.some((space) => space.slug === chosen))
    return chosen;
  return view.spaces[0]?.slug ?? null;
}

export function toWorkspaceSnapshot(
  view: DaemonView,
  setup: SetupState,
): WorkspaceSnapshot {
  return workspaceSnapshot.parse({
    version: 1,
    kind: "workspace-snapshot",
    preferences: { productId: activeSpace(view, setup) },
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

export function toWorkSnapshot(
  view: DaemonView,
  setup: SetupState,
  now: string,
): WorkSnapshot {
  const agents: WorkSnapshot["agents"] = [];
  const attention: WorkSnapshot["attention"] = [];
  if (view.spaces.length > 0) {
    agents.push({
      id: FIRST_MATE_ID,
      role: "First Mate",
      kind: "lead",
      launcherId: null,
      state: view.holds.length > 0 ? "waiting" : "idle",
      nowDoing: null,
      output: "",
      enabled: true,
    });
  }
  for (const task of view.fleet) {
    agents.push({
      id: `crew:${task.id}`,
      role: task.kind ? `${task.kind} · ${task.id}` : task.id,
      kind: "temporary",
      launcherId: FIRST_MATE_ID,
      state: agentState(task),
      nowDoing: task.current_state?.detail || null,
      output: task.hints?.last_event_text ?? "",
      enabled: true,
    });
  }
  for (const hold of view.holds) {
    attention.push({
      id: holdId(hold),
      kind: "question",
      groupId: null,
      workAreaId: null,
      title: hold.source === "crew" ? hold.summary : hold.title,
      detail:
        hold.source === "crew"
          ? `${hold.taskId} · ${hold.verb}`
          : `${hold.taskId} · ${hold.reason}`,
      state: "open",
      ref: hold.taskId,
      options: [],
      answer: null,
      createdAt: now,
    });
  }
  return workSnapshot.parse({
    version: 1,
    kind: "work-snapshot",
    setup: { ...setup, activeGroupId: activeSpace(view, setup) },
    groups: view.spaces.map((space, position) => ({
      id: space.slug,
      name: space.name,
      position,
    })),
    routes: [],
    areas: [],
    relations: [],
    records: [],
    objectives: [],
    permissions: [],
    grants: [],
    rules: [],
    ruleCandidate: null,
    attention,
    plans: [],
    blockers: [],
    reminders: [],
    rfps: [],
    roadmap: [],
    sprints: [],
    calendar: [],
    library: [],
    decisions: [],
    agents,
    activity: [],
    council: [],
    findings: [],
    memory: { unsynced: 0, disputed: 0, facts: [] },
    messages: [],
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
export class ContractAdapter {
  private view: DaemonView = { spaces: [], fleet: [], holds: [] };
  /** One First Mate per home, so one conversation for every product. */
  private conversation: Conversation | null = null;

  constructor(
    private readonly daemon: AmunTransport,
    private readonly setup: SetupStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async refresh(): Promise<void> {
    const spaces = await this.daemon.request<DaemonSpace[]>("spaces.list");
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
    this.view = { spaces, fleet: snapshot.tasks, holds };
  }

  workspace(): WorkspaceSnapshot {
    return toWorkspaceSnapshot(this.view, this.setup.load());
  }

  work(): WorkSnapshot {
    return toWorkSnapshot(this.view, this.setup.load(), this.now());
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
    if (message.kind === "auth" && message.action === "list")
      return [{ version: 1, kind: "auth-connections", connections: [] }];
    if (message.kind === "work") return this.handleWork(message);
    if (message.kind === "native-pi" && message.action === "run")
      return [await this.handleNativePi(message)];
    return [];
  }

  private async handleWork(message: Message): Promise<unknown[]> {
    const action = String(message.action);
    try {
      switch (action) {
        case "snapshot":
          await this.refresh();
          return [this.work()];
        case "setup":
          this.setup.save(
            setupState.parse({
              ...this.setup.load(),
              ...(message.patch as object),
            }),
          );
          return [this.result(action, true, ""), this.work()];
        case "finish-setup":
          this.setup.save({ ...this.setup.load(), completed: true });
          return [this.result(action, true, ""), this.work()];
        case "add-group": {
          const space = await this.daemon.request<DaemonSpace>(
            "spaces.create",
            {
              name: message.name,
            },
          );
          await this.refresh();
          return [
            this.result(action, true, `Created ${space.name}`, space.slug),
            this.work(),
          ];
        }
        case "resolve-attention": {
          const found = this.findHold(String(message.attentionId));
          if (!found)
            return [this.result(action, false, "That hold is no longer open.")];
          if (
            message.resolution !== "answer" ||
            typeof message.answer !== "string"
          )
            return [
              this.result(
                action,
                false,
                "Answer the First Mate to clear this hold.",
              ),
            ];
          const space = activeSpace(this.view, this.setup.load());
          if (!space)
            return [this.result(action, false, "Create a product first.")];
          await this.daemon.request("holds.answer", {
            space,
            hold: found,
            answer: message.answer,
          });
          await this.refresh();
          return [
            this.result(action, true, "Sent to the First Mate."),
            this.work(),
          ];
        }
        default:
          return [this.result(action, false, UNAVAILABLE)];
      }
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
      model: null,
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
      const space = activeSpace(this.view, this.setup.load());
      if (!space)
        return fail(
          "Create a product first, then talk to the First Mate here.",
        );
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
