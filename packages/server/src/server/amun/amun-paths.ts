import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface AmunPaths {
  /** ~/.amun, or AMUN_HOME. Amun's own files only. */
  amunHome: string;
  /** Amun's product list (one JSON file per product). */
  productsRoot: string;
  /**
   * The captain's single existing Firstmate home (FM_HOME), shared by every
   * product. AMUN_FIRSTMATE_HOME, default ~/Projects/firstmate. Amun reads it
   * and acts only through Firstmate's own scripts; it never writes into it.
   */
  fmHome: string;
  /**
   * Firstmate code root (FM_ROOT_OVERRIDE). The home itself when it is a
   * Firstmate checkout (Firstmate's default: home = repo), else vendor/firstmate.
   */
  firstmateRoot: string;
}

export class FirstmateRootNotFoundError extends Error {
  constructor(public readonly candidates: string[]) {
    super(`Firstmate not found. Looked in: ${candidates.join(", ")}`);
    this.name = "FirstmateRootNotFoundError";
  }
}

function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

/** A directory is a Firstmate code root when it has the contract and the scripts. */
export function isFirstmateCheckout(dir: string): boolean {
  return (
    existsSync(path.join(dir, "AGENTS.md")) &&
    existsSync(path.join(dir, "bin", "fm-send.sh"))
  );
}

/**
 * Finds the vendored Firstmate. AMUN_FIRSTMATE_ROOT wins (the Electron bundle
 * sets it); otherwise walk up from this module to the repository root.
 */
export function resolveFirstmateRoot(
  env: NodeJS.ProcessEnv = process.env,
  moduleUrl: string = import.meta.url,
): string {
  const candidates: string[] = [];
  if (env.AMUN_FIRSTMATE_ROOT)
    candidates.push(path.resolve(expandHome(env.AMUN_FIRSTMATE_ROOT)));
  let dir = path.dirname(fileURLToPath(moduleUrl));
  for (let depth = 0; depth < 8; depth += 1) {
    candidates.push(path.join(dir, "vendor", "firstmate"));
    dir = path.dirname(dir);
  }
  const found = candidates.find((candidate) =>
    existsSync(path.join(candidate, "AGENTS.md")),
  );
  if (!found) throw new FirstmateRootNotFoundError(candidates);
  return found;
}

export function resolveFirstmateHome(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.resolve(
    expandHome(
      env.AMUN_FIRSTMATE_HOME ?? env.FM_HOME ?? "~/Projects/firstmate",
    ),
  );
}

export function resolveAmunPaths(
  env: NodeJS.ProcessEnv = process.env,
): AmunPaths {
  const amunHome = path.resolve(expandHome(env.AMUN_HOME ?? "~/.amun"));
  const fmHome = resolveFirstmateHome(env);
  return {
    amunHome,
    productsRoot: path.join(amunHome, "products"),
    fmHome,
    firstmateRoot: isFirstmateCheckout(fmHome)
      ? fmHome
      : resolveFirstmateRoot(env),
  };
}
