/**
 * Detection of agent command-line tools already on the machine. This module
 * only classifies what a probe found. A probe may look a name up on the
 * path and run that tool's fixed version command; nothing else.
 */

export interface KnownTool {
  id: string;
  label: string;
  /** Executable name looked up on the path. */
  command: string;
  /** Fixed arguments that print the version and nothing else. */
  versionArgs: readonly string[];
  /** Oldest version Amun is known to work with, when one is known. */
  minVersion?: string;
  /** What Amun does with the tool and what it can reach. */
  access: string;
  /** What leaves the machine when the tool runs. */
  dataShared: string;
  /** How a person signs in. Shown, never run. */
  signIn: string;
  install: string;
  /** Reports status through lifecycle hooks Amun can read. */
  lifecycleEvents: boolean;
}

const providerNote =
  "Prompts, code and context the agent reads are sent to the tool's own provider under your account.";

export const knownTools: readonly KnownTool[] = [
  {
    id: "claude_code",
    label: "Claude Code",
    command: "claude",
    versionArgs: ["--version"],
    access: "Runs as a coding worker in the task's worktree.",
    dataShared: providerNote,
    signIn: "claude auth login",
    install: "Install Claude Code from Anthropic",
    lifecycleEvents: true,
  },
  {
    id: "codex",
    label: "Codex CLI",
    command: "codex",
    versionArgs: ["--version"],
    access: "Runs as a coding worker in the task's worktree.",
    dataShared: providerNote,
    signIn: "codex login",
    install: "Install the Codex CLI from OpenAI",
    lifecycleEvents: true,
  },
  {
    id: "pi",
    label: "Pi",
    command: "pi",
    versionArgs: ["--version"],
    access: "Amun bundles its own Pi; a separate installation is optional.",
    dataShared: providerNote,
    signIn: "Sign in from Amun's Models settings",
    install: "Not needed: Pi ships inside Amun",
    lifecycleEvents: true,
  },
  {
    id: "tmux",
    label: "tmux",
    command: "tmux",
    versionArgs: ["-V"],
    minVersion: "3.0.0",
    access: "Hosts worker sessions so they survive an app restart.",
    dataShared: "Nothing leaves the machine.",
    signIn: "No sign-in needed",
    install: "brew install tmux",
    lifecycleEvents: false,
  },
  {
    id: "git",
    label: "Git",
    command: "git",
    versionArgs: ["--version"],
    minVersion: "2.38.0",
    access: "Creates a worktree and branch for each task.",
    dataShared: "Pushes go only to the remotes your repositories name.",
    signIn: "Uses your existing Git credentials",
    install: "Install the Xcode command line tools",
    lifecycleEvents: false,
  },
  {
    id: "opencode",
    label: "OpenCode",
    command: "opencode",
    versionArgs: ["--version"],
    access: "Can run as a coding worker in the task's worktree.",
    dataShared: providerNote,
    signIn: "opencode auth login",
    install: "Install OpenCode",
    lifecycleEvents: false,
  },
  {
    id: "cursor_agent",
    label: "Cursor CLI",
    command: "cursor-agent",
    versionArgs: ["--version"],
    access: "Can run as a coding worker in the task's worktree.",
    dataShared: providerNote,
    signIn: "cursor-agent login",
    install: "Install the Cursor CLI",
    lifecycleEvents: false,
  },
];

/** What a probe reports about one tool. It never includes credentials. */
export interface ProbeResult {
  found: boolean;
  path?: string;
  /** Raw output of the version command. */
  versionText?: string;
  /** True, false, or undefined when sign-in could not be checked. */
  signedIn?: boolean;
  /** The operating system refused to run or read the tool. */
  denied?: boolean;
  error?: string;
}

export type ToolStatus =
  | "ready"
  | "needs_sign_in"
  | "not_installed"
  | "outdated"
  | "blocked"
  | "disabled";

export const toolStatusLabels: Record<ToolStatus, string> = {
  ready: "Ready to use",
  needs_sign_in: "Found, needs sign-in",
  not_installed: "Not installed",
  outdated: "Installed, needs an update",
  blocked: "Blocked on this Mac",
  disabled: "Turned off",
};

export interface ToolReport {
  id: string;
  label: string;
  status: ToolStatus;
  version: string | null;
  path: string | null;
  access: string;
  dataShared: string;
  /** The one thing to do next, in plain words. */
  nextAction: string;
  origin: "detected" | "manual";
  isDefault: boolean;
  lifecycleEvents: boolean;
}

/** The first x.y or x.y.z in the text, padded to three parts. */
export function extractVersion(text: string | undefined): string | null {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text ?? "");
  return match ? `${match[1]}.${match[2]}.${match[3] ?? "0"}` : null;
}

function older(version: string, minimum: string): boolean {
  const a = version.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i++)
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}

export interface ToolSetting {
  enabled: boolean;
  isDefault: boolean;
  origin: "detected" | "manual";
  path?: string;
}

/** Turns a probe result into a status and the next step for the user. */
export function classifyTool(
  tool: KnownTool,
  probe: ProbeResult,
  setting: ToolSetting = {
    enabled: true,
    isDefault: false,
    origin: "detected",
  },
): ToolReport {
  const version = extractVersion(probe.versionText);
  let status: ToolStatus;
  let nextAction: string;
  if (!setting.enabled) {
    status = "disabled";
    nextAction = "Turn it on to use it";
  } else if (probe.denied) {
    status = "blocked";
    nextAction =
      "Allow Amun to run it in macOS Privacy & Security, then refresh";
  } else if (!probe.found) {
    status = "not_installed";
    nextAction = tool.install + ", or skip";
  } else if (version === null) {
    status = "blocked";
    nextAction = "Its version could not be read; reinstall it, then refresh";
  } else if (tool.minVersion && older(version, tool.minVersion)) {
    status = "outdated";
    nextAction = `Update to ${tool.minVersion} or newer`;
  } else if (probe.signedIn === false) {
    status = "needs_sign_in";
    nextAction = "Sign in: " + tool.signIn;
  } else {
    status = "ready";
    nextAction = setting.isDefault
      ? "Nothing to do"
      : "Choose it as the default, or leave as is";
  }
  return {
    id: tool.id,
    label: tool.label,
    status,
    version,
    path: probe.path ?? setting.path ?? null,
    access: tool.access,
    dataShared: tool.dataShared,
    nextAction,
    origin: setting.origin,
    isDefault: setting.isDefault && status === "ready",
    lifecycleEvents: tool.lifecycleEvents,
  };
}

export function summarizeTools(reports: readonly ToolReport[]): string {
  const count = (status: ToolStatus) =>
    reports.filter((report) => report.status === status).length;
  return `${count("ready")} ready · ${count("needs_sign_in") + count("outdated") + count("blocked")} need attention · ${count("not_installed")} not installed`;
}
