import type { PrimaryHarness, ProductSpace } from "@getpaseo/protocol/amun-rpc";
import { firstmateEnv } from "./firstmate-cli.js";
import { findOnPath } from "./product-spaces.js";

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
  runAgent(agentId: string, text: string): Promise<{ finalText: string }>;
}

/**
 * Firstmate allows one live primary per home (session lock), and every product
 * shares the captain's home, so sessions are keyed by home, not by product.
 */
export class PrimarySessions {
  private readonly agents = new Map<string, string>();
  private readonly starting = new Map<string, Promise<{ agentId: string }>>();

  constructor(
    private readonly host: PrimaryHost,
    private readonly firstmateRoot: string,
    /** The captain's saved model for the First Mate, when there is one. */
    private readonly preferredModel: () => string | null = () => null,
  ) {}

  agentFor(fmHome: string): string | null {
    return this.agents.get(fmHome) ?? null;
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
    const started = this.host
      .createAgent(model ? { ...launch, model } : launch)
      .then(({ agentId }) => {
        this.agents.set(space.fmHome, agentId);
        return { agentId };
      })
      .finally(() => this.starting.delete(space.fmHome));
    this.starting.set(space.fmHome, started);
    return started;
  }

  async send(space: ProductSpace, text: string): Promise<{ agentId: string; reply: string }> {
    const { agentId } = await this.start(space);
    const { finalText } = await this.host.runAgent(agentId, text);
    return { agentId, reply: finalText };
  }
}
