/**
 * Project lifecycle manifest: the commands a repository declares for
 * setting up a worktree, running it and tearing it down. The file is read
 * from the repository, so it is treated as untrusted text and never run by
 * this module.
 */

export const manifestName = ".amun.json";
export const portVariable = "WORKSPACE_PORT";

export interface LifecycleManifest {
  /** Run once when the worktree is created, for example installing packages. */
  setup: string[];
  /** Starts the dev server or test environment. */
  run: string[];
  /** Run when the task closes, to remove containers or databases. */
  teardown: string[];
  /** Extra environment names the commands receive, with fixed values. */
  env: Record<string, string>;
}

const commandLimit = 2000;

function commands(value: unknown, name: string, problems: string[]): string[] {
  if (value === undefined) return [];
  const list = typeof value === "string" ? [value] : value;
  if (
    !Array.isArray(list) ||
    list.length > 20 ||
    list.some(
      (item) =>
        typeof item !== "string" ||
        !item.trim() ||
        item.length > commandLimit ||
        item.includes("\0"),
    )
  ) {
    problems.push(`${name} must be a command or a short list of commands`);
    return [];
  }
  return list as string[];
}

/** Parses manifest text. Throws with every problem found. */
export function parseManifest(text: string): LifecycleManifest {
  if (text.length > 65536) throw Error("The lifecycle manifest is too large");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw Error("The lifecycle manifest is not valid JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("The lifecycle manifest must be an object");
  const input = raw as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(input))
    if (!["setup", "run", "teardown", "env"].includes(key))
      problems.push(`Unknown lifecycle key: ${key}`);
  const env: Record<string, string> = {};
  if (input.env !== undefined) {
    if (!input.env || typeof input.env !== "object" || Array.isArray(input.env))
      problems.push("env must be an object of names and values");
    else
      for (const [name, value] of Object.entries(input.env)) {
        if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(name) || typeof value !== "string")
          problems.push(
            `env.${name} must be an upper-case name with a text value`,
          );
        else if (name === portVariable)
          problems.push(
            `${portVariable} is assigned by Amun and cannot be set`,
          );
        else if (/(SECRET|TOKEN|PASSWORD|API_?KEY)/.test(name))
          problems.push(
            `env.${name} looks like a secret; keep secrets out of the manifest`,
          );
        else env[name] = value;
      }
  }
  const manifest = {
    setup: commands(input.setup, "setup", problems),
    run: commands(input.run, "run", problems),
    teardown: commands(input.teardown, "teardown", problems),
    env,
  };
  if (problems.length) throw Error(problems.join("; "));
  return manifest;
}

/** The environment a task's commands receive, including its own port. */
export function taskEnvironment(
  manifest: LifecycleManifest,
  port: number,
): Record<string, string> {
  return { ...manifest.env, [portVariable]: String(port), PORT: String(port) };
}

export type ServiceHealth = "starting" | "healthy" | "unreachable" | "stopped";

/** The badge shown on a task tab, for example ":4102". */
export function portBadge(
  port: number | null,
  health: ServiceHealth,
): { label: string; url: string | null; status: string } {
  if (port === null)
    return { label: "No port", url: null, status: "No port assigned" };
  return {
    label: ":" + port,
    url: health === "stopped" ? null : `http://127.0.0.1:${port}/`,
    status: {
      starting: "Starting",
      healthy: "Running",
      unreachable: "Not responding",
      stopped: "Stopped",
    }[health],
  };
}

/** The ordered steps to close a task: teardown commands, then the port. */
export function teardownPlan(
  manifest: LifecycleManifest,
  port: number | null,
): string[] {
  return [
    ...manifest.teardown.map((command) => "Run: " + command),
    "Stop background processes started by this task",
    ...(port === null ? [] : [`Release port ${port}`]),
  ];
}
