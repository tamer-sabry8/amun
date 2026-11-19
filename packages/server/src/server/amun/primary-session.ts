import type { PrimaryHarness, ProductSpace } from "@getpaseo/protocol/amun-rpc";
import { firstmateEnv } from "./firstmate-cli.js";
import { findOnPath } from "./product-spaces.js";
import type { FirstMateRecordStore } from "./first-mate-records.js";

/**
 * Paseo provider ids for each primary harness. `agy` (Antigravity) was a Paseo
 * plugin provider upstream; Amun ships zero Paseo plugins, so it is refused
 * until a native provider exists rather than silently falling back.
 */
const PASEO_PROVIDER: Record<PrimaryHarness, string | null> = {
  pi: "pi",
  claude: "claude",
  codex: "codex",
  agy: null,
};

export class UnsupportedHarnessError extends Error {
  constructor(public readonly harness: PrimaryHarness) {
    super(`The ${harness} primary harness is not available in this Amun build`);
    this.name = "UnsupportedHarnessError";
  }
}

export interface PrimaryLaunch {
  provider: string;
  /** Firstmate runs from its code root; FM_HOME selects the Product Space. */
  cwd: string;
  env: Record<string, string>;
  title: string;
  /** The captain's saved model choice; the host applies it once the agent is up. */
  model?: string;
}

export interface BuildLaunchInput {
  space: ProductSpace;
  firstmateRoot: string;
  harness?: PrimaryHarness;
  baseEnv?: NodeJS.ProcessEnv;
}

/**
 * One primary session per Firstmate home: the First Mate. It runs headless
 * (Paseo's Pi provider uses `pi --mode rpc`), so the captain never sees a
 * terminal. cwd is the code root (the home itself when home = repo), so Pi
 * auto-loads the home's .pi/extensions once project trust is approved; Claude
 * runs Firstmate's SessionStart hook, which executes bin/fm-session-start.sh.
 */
export function buildPrimaryLaunch(input: BuildLaunchInput): PrimaryLaunch {
  const harness = input.harness ?? input.space.harness;
  const provider = PASEO_PROVIDER[harness];
  if (!provider) throw new UnsupportedHarnessError(harness);
  const env = firstmateEnv(
    { root: input.firstmateRoot, fmHome: input.space.fmHome },
    input.baseEnv ?? process.env,
  );
  return {
    provider,
    cwd: input.firstmateRoot,
    env,
    title: "First Mate",
  };
}

export interface HostToolCheck {
  tool: string;
  found: string | null;
  required: boolean;
  install: string;
}

/** Tools Firstmate's bootstrap requires on PATH (docs/configuration.md "Toolchain"). */
export function checkHostTools(
  space: ProductSpace,
  pathValue: string = process.env.PATH ?? "",
): HostToolCheck[] {
  const backendTool =
    space.backend === "hc"
      ? { tool: "herdr-core", install: "vendor/firstmate/bin/fm-install-hc.sh" }
      : { tool: "tmux", install: "brew install tmux" };
  const checks = [
    { ...backendTool, required: true },
    { tool: "treehouse", install: "vendor/firstmate/bin/fm-install-treehouse.sh", required: true },
    { tool: "tasks-axi", install: "npm install -g tasks-axi", required: true },
    { tool: "jq", install: "brew install jq", required: true },
    { tool: "git", install: "xcode-select --install", required: true },
  ];
  return checks.map((check) => ({ ...check, found: findOnPath(check.tool, pathValue) }));
}

/** The slice of Paseo's AgentManager the First Mate needs. */
export interface PrimaryHost {
  createAgent(launch: PrimaryLaunch): Promise<{ agentId: string }>;
  /**
   * Brings back a First Mate this home had before the daemon restarted, with
   * its conversation. True only when that agent is still there, is not
   * archived, and runs the same harness in the same Firstmate checkout.
   */
  resumeAgent?(agentId: string, launch: PrimaryLaunch): Promise<boolean>;
  runAgent(agentId: string, text: string): Promise<{ finalText: string }>;
  /** Ends a turn that is still open, so the next message can be sent. */
  cancelRun?(agentId: string): Promise<void>;
}

/** The First Mate could not take or finish a message; said in plain words. */
export class FirstMateTurnError extends Error {
  constructor(
    message: string,
    public readonly detail: string,
  ) {
    super(message);
    this.name = "FirstMateTurnError";
  }
}

/** What to tell the captain when a turn fails, without Paseo's internals. */
export function describeTurnFailure(error: unknown): FirstMateTurnError {
  const detail = error instanceof Error ? error.message : String(error);
  if (/timed out/i.test(detail))
    return new FirstMateTurnError(
      "Firstmate took too long to answer and that message was stopped. Send it again.",
      detail,
    );
  if (/already has an active run/i.test(detail))
    return new FirstMateTurnError(
      "Firstmate was still busy with an earlier message, which has now been stopped. Send this one again.",
      detail,
    );
  return new FirstMateTurnError(`Firstmate could not answer: ${detail}`, detail);
}

/**
 * Firstmate allows one live primary per home (session lock), and every product
 * shares the captain's home, so sessions are keyed by home, not by product.
 */
export class PrimarySessions {
  private readonly agents = new Map<string, string>();
  private readonly starting = new Map<string, Promise<{ agentId: string }>>();
  /** One message at a time per home: the First Mate takes a single turn. */
  private readonly turns = new Map<string, Promise<unknown>>();
  private readonly waiting = new Map<string, number>();
  /** First Mate agents with a turn Amun itself asked for, still open. */
  private readonly amunTurns = new Set<string>();

  constructor(
    private readonly host: PrimaryHost,
    private readonly firstmateRoot: string,
    /** The captain's saved model for the First Mate, when there is one. */
    private readonly preferredModel: () => string | null = () => null,
    /** Which agent was this home's First Mate, kept across daemon restarts. */
    private readonly records: FirstMateRecordStore | null = null,
  ) {}

  agentFor(fmHome: string): string | null {
    return this.agents.get(fmHome) ?? null;
  }

  /** The home this agent is the First Mate of, or null for any other agent. */
  homeOf(agentId: string): string | null {
    for (const [home, id] of this.agents) if (id === agentId) return home;
    return null;
  }

  /**
   * Whether the turn now running for this agent was asked for by Amun. A turn
   * that was not (a heartbeat, a Firstmate wake or guard notice) has a reply
   * nobody is waiting for, so it is shown to the captain separately.
   */
  isAmunTurn(agentId: string): boolean {
    return this.amunTurns.has(agentId);
  }

  async start(space: ProductSpace, harness?: PrimaryHarness): Promise<{ agentId: string }> {
    const existing = this.agents.get(space.fmHome);
    if (existing) return { agentId: existing };
    const pending = this.starting.get(space.fmHome);
    if (pending) return pending;
    const launch = buildPrimaryLaunch({
      space,
      firstmateRoot: this.firstmateRoot,
      ...(harness ? { harness } : {}),
    });
    const model = this.preferredModel();
    const withModel = model ? { ...launch, model } : launch;
    const started = this.resume(space.fmHome, withModel)
      .then(async (resumed) => {
        const agentId = resumed ?? (await this.host.createAgent(withModel)).agentId;
        this.agents.set(space.fmHome, agentId);
        if (!resumed) this.records?.write(space.fmHome, agentId);
        return { agentId };
      })
      .finally(() => this.starting.delete(space.fmHome));
    this.starting.set(space.fmHome, started);
    return started;
  }

  /** The home's earlier First Mate, when it can still be brought back. */
  private async resume(fmHome: string, launch: PrimaryLaunch): Promise<string | null> {
    const earlier = this.records?.read(fmHome) ?? null;
    if (!earlier || !this.host.resumeAgent) return null;
    const resumed = await this.host.resumeAgent(earlier, launch).catch(() => false);
    return resumed ? earlier : null;
  }

  /** Messages being answered or waiting their turn for this home. */
  pending(fmHome: string): number {
    return this.waiting.get(fmHome) ?? 0;
  }

  /**
   * Messages for one home are answered in order. Paseo refuses a second turn
   * while one is open, so a message sent while the First Mate is still
   * working waits here instead of failing. A turn that fails is closed, so
   * one stuck message can never block every message after it.
   */
  send(space: ProductSpace, text: string): Promise<{ agentId: string; reply: string }> {
    const home = space.fmHome;
    this.waiting.set(home, this.pending(home) + 1);
    const before = this.turns.get(home) ?? Promise.resolve();
    const turn = before
      .catch(() => undefined)
      .then(() => this.takeTurn(space, text))
      .finally(() => {
        this.waiting.set(home, Math.max(0, this.pending(home) - 1));
      });
    this.turns.set(home, turn);
    return turn;
  }

  private async takeTurn(
    space: ProductSpace,
    text: string,
  ): Promise<{ agentId: string; reply: string }> {
    const { agentId } = await this.start(space);
    this.amunTurns.add(agentId);
    try {
      const { finalText } = await this.host.runAgent(agentId, text);
      return { agentId, reply: finalText };
    } catch (error) {
      await this.host.cancelRun?.(agentId).catch(() => undefined);
      throw describeTurnFailure(error);
    } finally {
      this.amunTurns.delete(agentId);
    }
  }
}
