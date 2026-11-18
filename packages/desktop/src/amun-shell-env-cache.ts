// Amun: the login shell's environment is remembered between launches.
//
// Reading it means starting the user's shell, and a slow shell profile held
// the window back for 20 seconds or more on every launch. Now the first launch
// reads it as before and saves what the shell added; later launches apply the
// saved copy at once and read it again in a separate process, so a changed
// PATH is picked up for the next launch without anyone waiting.
import { spawn as defaultSpawn } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SHELL_ENV_CACHE_VERSION = 1;
/** Set for the refresh process: where to write, and that it must not recurse. */
export const SHELL_ENV_REFRESH_TARGET = "AMUN_SHELL_ENV_REFRESH_TARGET";

/** The login-shell lookup's own timeout setting (login-shell-env.ts). */
const QUICK_READ_TIMEOUT_KEY = "PASEO_SHELL_ENV_TIMEOUT_MS";
/** Total for both attempts at the first launch: three seconds each. */
const QUICK_READ_TIMEOUT_MS = "6000";

interface ShellEnvCache {
  version: number;
  shell: string | null;
  savedAt: string;
  /** Only what the shell added or changed, never the whole environment. */
  env: Record<string, string>;
}

interface CacheLogger {
  info(message: string, details?: object): void;
  warn(message: string, details?: object): void;
}

export interface ShellEnvCacheInput {
  cacheFile: string;
  env: NodeJS.ProcessEnv;
  /** Reads the login shell and applies it to `env` (slow, blocking). */
  inherit: () => void;
  /** Starts the out-of-process refresh; absent when there is nothing to run. */
  refresh?: () => void;
  logger: CacheLogger;
  now?: () => Date;
}

export function readShellEnvCache(file: string, shell: string | null): ShellEnvCache | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const cache = parsed as Partial<ShellEnvCache>;
    if (cache.version !== SHELL_ENV_CACHE_VERSION) return null;
    // A different shell has a different profile: read it afresh.
    if ((cache.shell ?? null) !== shell) return null;
    if (typeof cache.env !== "object" || cache.env === null) return null;
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(cache.env))
      if (typeof value === "string") env[key] = value;
    if (!Object.keys(env).length) return null;
    return {
      version: SHELL_ENV_CACHE_VERSION,
      shell: cache.shell ?? null,
      savedAt: typeof cache.savedAt === "string" ? cache.savedAt : "",
      env,
    };
  } catch {
    return null;
  }
}

/** What the shell added or changed, compared with the environment before it. */
export function shellEnvChanges(
  before: Record<string, string | undefined>,
  after: NodeJS.ProcessEnv,
): Record<string, string> {
  const changes: Record<string, string> = {};
  for (const [key, value] of Object.entries(after))
    if (typeof value === "string" && before[key] !== value) changes[key] = value;
  return changes;
}

export function writeShellEnvCache(
  file: string,
  shell: string | null,
  env: Record<string, string>,
  now: Date = new Date(),
): void {
  if (!Object.keys(env).length) return;
  const cache: ShellEnvCache = {
    version: SHELL_ENV_CACHE_VERSION,
    shell,
    savedAt: now.toISOString(),
    env,
  };
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  // The shell profile may export keys; the copy is readable by the owner only.
  writeFileSync(temporary, JSON.stringify(cache), { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
}

/**
 * Applies the saved shell environment when there is one and refreshes it out
 * of process; reads the shell directly (and saves the result) when there is
 * none. Returns which of the two happened.
 */
export function inheritLoginShellEnvWithCache(input: ShellEnvCacheInput): "cached" | "read" {
  const shell = input.env.SHELL ?? null;
  const cached = readShellEnvCache(input.cacheFile, shell);
  if (cached) {
    Object.assign(input.env, cached.env);
    input.logger.info("[login-shell-env] applied the saved copy", {
      savedAt: cached.savedAt,
      keys: Object.keys(cached.env).length,
    });
    input.refresh?.();
    return "cached";
  }
  // First launch: a quick read so the window is not kept waiting; the full
  // read happens out of process and is there from the next launch on.
  const before = { ...input.env };
  const hadTimeout = input.env[QUICK_READ_TIMEOUT_KEY];
  input.env[QUICK_READ_TIMEOUT_KEY] ??= QUICK_READ_TIMEOUT_MS;
  try {
    input.inherit();
  } finally {
    if (hadTimeout === undefined) delete input.env[QUICK_READ_TIMEOUT_KEY];
  }
  delete before[QUICK_READ_TIMEOUT_KEY];
  try {
    writeShellEnvCache(
      input.cacheFile,
      shell,
      shellEnvChanges(before, input.env),
      input.now?.() ?? new Date(),
    );
  } catch (error) {
    input.logger.warn("[login-shell-env] could not save a copy", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  input.refresh?.();
  return "read";
}

export interface RefreshInput {
  /** The Electron executable, run as Node. */
  execPath: string;
  /** dist/amun-shell-env-refresh.js */
  script: string;
  cacheFile: string;
  /** The environment as it was before the saved copy was applied. */
  baseEnv: NodeJS.ProcessEnv;
  spawn?: typeof defaultSpawn;
}

/** Reads the shell again in its own process; nothing here waits for it. */
export function startShellEnvRefresh(input: RefreshInput): void {
  const spawn = input.spawn ?? defaultSpawn;
  const child = spawn(input.execPath, [input.script], {
    detached: true,
    stdio: "ignore",
    env: {
      ...input.baseEnv,
      ELECTRON_RUN_AS_NODE: "1",
      [SHELL_ENV_REFRESH_TARGET]: input.cacheFile,
    },
  });
  child.on("error", () => undefined);
  child.unref();
}
