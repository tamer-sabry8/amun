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
}

export interface BuildLaunchInput {
  space: ProductSpace;
  firstmateRoot: string;
  harness?: PrimaryHarness;
  baseEnv?: NodeJS.ProcessEnv;
}

/**
 * One primary session per Product Space: the First Mate. Pi auto-loads the
 * vendored .pi/extensions (supervision branch, calm, watcher) once project trust
 * is approved for vendor/firstmate; Claude runs Firstmate's SessionStart hook
 * from .claude/settings.json, which executes bin/fm-session-start.sh.
 */
export function buildPrimaryLaunch(input: BuildLaunchInput): PrimaryLaunch {
  const harness = input.harness ?? input.space.harness;
  const provider = PASEO_PROVIDER[harness];
  if (!provider) throw new UnsupportedHarnessError(harness);
  const env = firstmateEnv(
    { root: input.firstmateRoot, fmHome: input.space.fmHome },
    input.baseEnv ?? process.env,
  );
  env.AMUN_SPACE = input.space.slug;
  return {
    provider,
    cwd: input.firstmateRoot,
    env,
    title: `First Mate · ${input.space.name}`,
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

export class PrimarySessions {
  private readonly agents = new Map<string, string>();

  constructor(
    private readonly host: PrimaryHost,
    private readonly firstmateRoot: string,
  ) {}

  agentFor(slug: string): string | null {
    return this.agents.get(slug) ?? null;
  }

  async start(space: ProductSpace, harness?: PrimaryHarness): Promise<{ agentId: string }> {
    const existing = this.agents.get(space.slug);
    if (existing) return { agentId: existing };
    const launch = buildPrimaryLaunch({
      space,
      firstmateRoot: this.firstmateRoot,
      ...(harness ? { harness } : {}),
    });
    const { agentId } = await this.host.createAgent(launch);
    this.agents.set(space.slug, agentId);
    return { agentId };
  }

  async send(space: ProductSpace, text: string): Promise<{ agentId: string; reply: string }> {
    const { agentId } = await this.start(space);
    const { finalText } = await this.host.runAgent(agentId, text);
    return { agentId, reply: finalText };
  }
}
