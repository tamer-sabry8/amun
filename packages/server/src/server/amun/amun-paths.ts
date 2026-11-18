import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface AmunPaths {
  /** ~/.amun, or AMUN_HOME. */
  amunHome: string;
  /** Amun-owned bare repository backing every Product Space home. */
  homesRepo: string;
  /** Parent of the per-space FM_HOME worktrees. */
  homesRoot: string;
  /** Absolute path of the vendored Firstmate code root (FM_ROOT_OVERRIDE). */
  firstmateRoot: string;
}

export class FirstmateRootNotFoundError extends Error {
  constructor(public readonly candidates: string[]) {
    super(`Vendored Firstmate not found. Looked in: ${candidates.join(", ")}`);
    this.name = "FirstmateRootNotFoundError";
  }
}

function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

/**
 * Finds vendor/firstmate. AMUN_FIRSTMATE_ROOT wins (the Electron bundle sets it);
 * otherwise walk up from this module to the repository root.
 */
export function resolveFirstmateRoot(
  env: NodeJS.ProcessEnv = process.env,
  moduleUrl: string = import.meta.url,
): string {
  const candidates: string[] = [];
  if (env.AMUN_FIRSTMATE_ROOT) candidates.push(path.resolve(expandHome(env.AMUN_FIRSTMATE_ROOT)));
  let dir = path.dirname(fileURLToPath(moduleUrl));
  for (let depth = 0; depth < 8; depth += 1) {
    candidates.push(path.join(dir, "vendor", "firstmate"));
    dir = path.dirname(dir);
  }
  const found = candidates.find((candidate) => existsSync(path.join(candidate, "AGENTS.md")));
  if (!found) throw new FirstmateRootNotFoundError(candidates);
  return found;
}

export function resolveAmunPaths(env: NodeJS.ProcessEnv = process.env): AmunPaths {
  const amunHome = path.resolve(expandHome(env.AMUN_HOME ?? "~/.amun"));
  return {
    amunHome,
    homesRepo: path.join(amunHome, "homes.git"),
    homesRoot: path.join(amunHome, "homes"),
    firstmateRoot: resolveFirstmateRoot(env),
  };
}
