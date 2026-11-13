// Council orchestration inside Amun's service: status, a headless Chair run on
// Claude Code, Chair questions bridged to the Island, and updates.
// Everything external (process spawn, upstream fetch, Claude lookup) is
// injected so the logic is testable without a model or a network.
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  askToolName,
  chairInvocation,
  parseCouncilCommand,
  updateDue,
} from "../../domain/src/work/council.ts";
import type { CouncilStatus } from "../../contracts/src/work.ts";
import { answer, pending } from "./bridge.ts";
import {
  readManifest,
  rollback,
  seats,
  setSeatDisabled,
  compose,
  update,
  install,
  type Fetcher,
  type Pin,
} from "./runtime.ts";

export interface ChairProcess {
  /** Resolves with the exit code once the Chair has finished. */
  done: Promise<number>;
  stop(): void;
}
/** The slice of the work store the Council needs. */
export interface CouncilRecords {
  handle(command: unknown): { kind: string; ref?: string | null }[];
  snapshot(): {
    attention: {
      id: string;
      ref: string | null;
      state: string;
      answer: string | null;
    }[];
  };
}
export interface CouncilDeps {
  root: string;
  records: CouncilRecords;
  /** Path to Claude Code, or null when it is not on this Mac. */
  findClaude(): Promise<string | null>;
  spawn(input: {
    command: string;
    args: string[];
    cwd: string;
    stdin: string;
  }): ChairProcess;
  /** How Claude Code should start the owner-question tool server. */
  askServer: { command: string; args: string[]; env?: Record<string, string> };
  fetcher(repo: string): Fetcher;
  bundledNode: string;
  /** Opens the live room view and returns its loopback address. */
  room?: { start(dir: string): Promise<string>; stop(): void };
  /** The pinned version shipped with Amun, installed on first use. */
  shipped?: { directory: string; pin: Pin } | null;
  tokensCss?: string;
  themes?: string[];
  now?: () => Date;
}

const send = (
  records: CouncilRecords,
  action: string,
  payload: Record<string, unknown>,
) =>
  records
    .handle({ version: 1, kind: "work", action, ...payload })
    .find((event) => event.kind === "work-result")?.ref ?? null;

export class CouncilService {
  private readonly deps: CouncilDeps;
  private running: { sessionId: string; process: ChairProcess } | null = null;
  private message = "";
  private roomUrl: string | null = null;
  private installing: Promise<void> | null = null;
  constructor(deps: CouncilDeps) {
    this.deps = deps;
  }
  private get bridge() {
    return join(this.deps.root, "bridge");
  }

  /** Installs the shipped version once, the first time it is needed. */
  private async ensureInstalled() {
    const shipped = this.deps.shipped;
    if (!shipped) return;
    this.installing ??= install(
      this.deps.root,
      shipped.directory,
      shipped.pin,
      {
        ...(this.deps.tokensCss ? { tokensCss: this.deps.tokensCss } : {}),
        ...(this.deps.themes ? { themes: this.deps.themes } : {}),
        ...(this.deps.now ? { now: this.deps.now() } : {}),
      },
    ).then(
      (result) => {
        if (result.problems.length) this.message = result.problems[0]!;
      },
      () => {
        this.message = "The Council’s advisors could not be installed.";
      },
    );
    await this.installing;
  }

  async openRoom() {
    await this.ensureInstalled();
    const manifest = await readManifest(this.deps.root);
    if (!manifest.current || !this.deps.room) {
      this.message = "The room is not available yet.";
      return this.status();
    }
    try {
      this.roomUrl = await this.deps.room.start(
        join(this.deps.root, "runtime", "current"),
      );
      this.message = "";
    } catch (error) {
      this.roomUrl = null;
      this.message =
        error instanceof Error ? error.message : "The room did not start.";
    }
    return this.status();
  }
  closeRoom() {
    this.deps.room?.stop();
    this.roomUrl = null;
    return this.status();
  }

  async status(): Promise<CouncilStatus> {
    await this.ensureInstalled();
    const manifest = await readManifest(this.deps.root);
    return {
      version: 1,
      kind: "council-status",
      installed: !!manifest.current,
      commit: manifest.current?.commit ?? null,
      previous: manifest.previous?.commit ?? null,
      repo: manifest.repo,
      claude: (await this.deps.findClaude()) !== null,
      seats: await seats(this.deps.root),
      roomUrl: this.roomUrl,
      message: this.message,
    };
  }

  async toggleSeat(key: string, disabled: boolean) {
    await setSeatDisabled(this.deps.root, key, disabled);
    const manifest = await readManifest(this.deps.root);
    if (manifest.current) {
      const result = await compose(
        this.deps.root,
        manifest.current.commit,
        this.deps,
      );
      this.message = result.problems[0] ?? "";
    }
    return this.status();
  }

  /** Weekly check, or on request. Applies only a validated update. */
  async checkUpdate(force = false) {
    const manifest = await readManifest(this.deps.root);
    if (!manifest.repo) {
      this.message = "No source is set for the Council’s advisors yet.";
      return this.status();
    }
    const now = this.deps.now?.() ?? new Date();
    if (!force && !updateDue(manifest, now.getTime())) return this.status();
    try {
      const result = await update(
        this.deps.root,
        this.deps.fetcher(manifest.repo),
        {
          bundledNode: this.deps.bundledNode,
          now,
          ...(this.deps.tokensCss ? { tokensCss: this.deps.tokensCss } : {}),
          ...(this.deps.themes ? { themes: this.deps.themes } : {}),
        },
      );
      if (result.state === "current")
        this.message = "The Council is up to date.";
      else if (result.state === "rejected") {
        this.message = `An update was not applied: ${result.problems[0]}`;
        send(this.deps.records, "activity", {
          groupId: null,
          workAreaId: null,
          text: `Council update ${result.commit.slice(0, 7)} was not applied: ${result.problems.join(" ")}`,
          state: "failed",
          silent: true,
        });
      } else {
        this.message =
          result.restart === "restart"
            ? `Updated to ${result.commit.slice(0, 7)}. Restart Amun to finish: ${result.reasons.join(" ")}`
            : `Updated to ${result.commit.slice(0, 7)}.`;
        send(this.deps.records, "activity", {
          groupId: null,
          workAreaId: null,
          text:
            `Council updated to ${result.commit.slice(0, 7)} · ${result.changedFiles.length} files changed` +
            (result.executable.length
              ? ` · ${result.executable.length} scripts changed`
              : ""),
          state: "finished",
          silent: true,
        });
      }
    } catch (error) {
      this.message =
        "The Council could not check for updates: " +
        (error instanceof Error ? error.message : "unknown error");
    }
    return this.status();
  }

  async rollback() {
    const result = await rollback(this.deps.root, this.deps);
    this.message = result.ok
      ? `Went back to ${result.commit.slice(0, 7)}.`
      : result.problems[0]!;
    return this.status();
  }

  /** Starts a council. Returns a plain reason when it cannot start. */
  async run(input: {
    text: string;
    workAreaId: string | null;
    groupId: string | null;
    context?: string;
  }): Promise<{ ok: true; sessionId: string } | { ok: false; reason: string }> {
    const command = parseCouncilCommand(input.text);
    if (!command)
      return { ok: false, reason: "That is not a Council command." };
    if (command.kind === "error") return { ok: false, reason: command.message };
    if (this.running)
      return { ok: false, reason: "A council is already in session." };
    await this.ensureInstalled();
    const manifest = await readManifest(this.deps.root);
    if (!manifest.current)
      return {
        ok: false,
        reason: "The Council’s advisors are not installed yet.",
      };
    const claude = await this.deps.findClaude();
    if (!claude)
      return {
        ok: false,
        reason:
          "The Council runs on Claude Code, which was not found on this Mac.",
      };
    const cwd = join(this.deps.root, "runtime", "current");
    await mkdir(this.bridge, { recursive: true, mode: 0o700 });
    const mcpConfigPath = join(this.deps.root, "mcp.json");
    await writeFile(
      mcpConfigPath,
      JSON.stringify({
        mcpServers: {
          amun_council: {
            command: this.deps.askServer.command,
            args: [...this.deps.askServer.args, this.bridge],
            ...(this.deps.askServer.env
              ? { env: this.deps.askServer.env }
              : {}),
          },
        },
      }),
      { mode: 0o600 },
    );
    const invocation = chairInvocation({
      command,
      mcpConfigPath,
      ...(input.context ? { context: input.context } : {}),
    })!;
    const decision =
      command.kind === "council"
        ? command.decision
        : command.kind === "ask"
          ? command.question
          : input.text;
    const mode = command.kind === "council" ? command.mode : command.kind;
    const session = {
      decision,
      groupId: input.groupId,
      workAreaId: input.workAreaId,
      mode,
    };
    const sessionId = send(this.deps.records, "council-session", {
      ...session,
      state: "running",
    });
    if (!sessionId)
      return { ok: false, reason: "The council could not be recorded." };
    const activityId = send(this.deps.records, "activity", {
      groupId: input.groupId,
      workAreaId: input.workAreaId,
      text: `Council in session: ${decision}`,
      state: "running",
      ref: "council:" + sessionId,
    });
    const startedAt = (this.deps.now?.() ?? new Date()).getTime();
    const process = this.deps.spawn({
      command: claude,
      args: invocation.args,
      cwd,
      stdin: invocation.stdin,
    });
    this.running = { sessionId, process };
    void process.done
      .catch(() => 1)
      .then(async (code) => {
        this.running = null;
        const verdict = code === 0 ? await this.verdict(startedAt) : null;
        const state = code === 0 ? "finished" : "failed";
        send(this.deps.records, "council-session", {
          ...session,
          sessionId,
          state,
          recommendation: verdict,
        });
        // Its own Activity row and attention item, like any delegated task.
        send(this.deps.records, "activity", {
          activityId,
          groupId: input.groupId,
          workAreaId: input.workAreaId,
          text:
            code === 0
              ? `Council verdict ready: ${decision}`
              : `Council did not finish: ${decision}`,
          state,
        });
      });
    return { ok: true, sessionId };
  }

  /** The recommendation from the newest verdict written since the run began. */
  private async verdict(since: number): Promise<string | null> {
    const dir = join(this.deps.root, "sessions");
    let newest: { path: string; time: number } | null = null;
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      const path = join(dir, name, "verdict.md");
      const info = await stat(path).catch(() => null);
      if (
        info &&
        info.mtimeMs >= since - 1000 &&
        (!newest || info.mtimeMs > newest.time)
      )
        newest = { path, time: info.mtimeMs };
    }
    if (!newest) return null;
    const text = await readFile(newest.path, "utf8");
    const section = /^#+\s*.*recommendation.*$/im.exec(text);
    const body = (
      section ? text.slice(section.index + section[0].length) : text
    )
      .split(/\n#+\s/)[0]!
      .trim();
    return body ? body.slice(0, 1200) : null;
  }

  /**
   * Moves Chair questions to the Island and owner answers back to the Chair.
   * Called on a timer by the service. Only the council waits; nothing else
   * pauses and nothing is assumed.
   */
  async poll() {
    const waitingOn = await pending(this.bridge);
    // Idle most of the time: do not build a snapshot unless the Chair asked.
    if (!waitingOn.length) return;
    const attention = this.deps.records.snapshot().attention;
    for (const question of waitingOn) {
      const ref = "council-question:" + question.id;
      const item = attention.find((entry) => entry.ref === ref);
      if (!item) {
        send(this.deps.records, "attention", {
          attentionKind: "question",
          groupId: null,
          workAreaId: null,
          title: question.questions[0]!.question,
          detail:
            question.questions.length > 1
              ? question.questions
                  .slice(1)
                  .map((entry) => entry.question)
                  .join(" · ")
              : "The Council’s Chair needs this to continue.",
          ref,
          options: question.questions[0]!.options,
        });
        if (this.running)
          send(this.deps.records, "council-session", {
            sessionId: this.running.sessionId,
            decision: "-",
            groupId: null,
            workAreaId: null,
            mode: "-",
            state: "waiting_on_you",
          });
      } else if (item.state === "done" && item.answer !== null) {
        await answer(this.bridge, question.id, [item.answer]);
        if (this.running)
          send(this.deps.records, "council-session", {
            sessionId: this.running.sessionId,
            decision: "-",
            groupId: null,
            workAreaId: null,
            mode: "-",
            state: "running",
          });
      }
    }
  }

  stop() {
    this.running?.process.stop();
    this.running = null;
    this.deps.room?.stop();
    this.roomUrl = null;
  }
}
export { askToolName };
