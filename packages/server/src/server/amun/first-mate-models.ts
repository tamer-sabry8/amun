import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { findOnPath } from "./product-spaces.js";

const run = promisify(execFile);

export interface ModelChoice {
  /** Pi's "provider/model" id, e.g. "github-copilot/claude-sonnet-5". */
  id: string;
  label: string;
}

export interface FirstMateModelList {
  /** The model the First Mate is on, or Pi's default before it has started. */
  current: string | null;
  models: ModelChoice[];
}

export interface ListedModel extends ModelChoice {
  isDefault?: boolean;
}

/** The slice of Paseo the model picker needs. */
export interface ModelHost {
  /** Models Pi offers from the accounts signed in to it. */
  listModels(): Promise<ListedModel[]>;
  /** The model a running agent is on, when Paseo knows it. */
  currentModel(agentId: string): string | null;
  /** Switches a running agent; resolves to the model now in use. */
  setModel(agentId: string, model: string): Promise<string | null>;
}

export class UnknownModelError extends Error {
  constructor(public readonly model: string) {
    super(`Pi does not offer the model ${model}. Sign in to its provider first.`);
    this.name = "UnknownModelError";
  }
}

/**
 * The captain's model choice for the First Mate. It lives in Amun's own home
 * (never the Firstmate home) so the choice survives a restart of the daemon.
 */
export class FirstMateModelChoice {
  private readonly file: string;

  constructor(amunHome: string) {
    this.file = path.join(amunHome, "first-mate-model.json");
  }

  read(): string | null {
    if (!existsSync(this.file)) return null;
    try {
      const saved: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      return typeof saved === "object" &&
        saved !== null &&
        "model" in saved &&
        typeof saved.model === "string"
        ? saved.model
        : null;
    } catch {
      return null;
    }
  }

  write(model: string): void {
    writeFileSync(this.file, JSON.stringify({ model }));
  }
}

export type AccountStatus = "ready" | "missing" | "error";

export interface AccountCheck {
  provider: string;
  status: AccountStatus;
  /** Why it is not ready, in Pi's words (e.g. credentials_not_configured). */
  reason: string | null;
}

export class PiNotFoundError extends Error {
  constructor() {
    super("Pi is not installed on this Mac, so Amun cannot check model sign-ins.");
    this.name = "PiNotFoundError";
  }
}

interface PiAuthCheckOutput {
  status?: unknown;
  reason?: unknown;
}

export type RunPi = (args: string[]) => Promise<string>;

/** Runs the Pi found on PATH. Model sign-ins belong to Pi; Amun only asks it. */
export function piOnPath(pathValue: () => string = () => process.env.PATH ?? ""): RunPi {
  return async (args) => {
    const pi = findOnPath("pi", pathValue());
    if (!pi) throw new PiNotFoundError();
    const { stdout } = await run(pi, args, { timeout: 30_000, maxBuffer: 1024 * 1024 });
    return stdout;
  };
}

/**
 * Asks Pi whether a provider is signed in (`pi auth check --json`). Pi answers
 * with a status only; the credential itself never leaves Pi.
 */
export async function checkPiAccount(provider: string, runPi: RunPi): Promise<AccountCheck> {
  let stdout: string;
  try {
    stdout = await runPi(["auth", "check", "--provider", provider, "--json"]);
  } catch (error) {
    if (error instanceof PiNotFoundError) throw error;
    // Pi exits non-zero for some failures but still prints its JSON answer.
    const printed =
      typeof error === "object" && error !== null && "stdout" in error ? error.stdout : null;
    if (typeof printed !== "string" || !printed.trim())
      return { provider, status: "error", reason: "check_failed" };
    stdout = printed;
  }
  let answer: PiAuthCheckOutput;
  try {
    answer = JSON.parse(stdout) as PiAuthCheckOutput;
  } catch {
    return { provider, status: "error", reason: "unreadable_answer" };
  }
  const reason = typeof answer.reason === "string" ? answer.reason : null;
  if (answer.status === "ready") return { provider, status: "ready", reason: null };
  if (reason === "credentials_not_configured") return { provider, status: "missing", reason };
  // Pi holds a sign-in it could not renew with the provider (seen with Claude
  // Pro/Max on 20 November 2026: the stored sign-in passes a check that does
  // not renew it, and fails one that does). The owner has to sign in again;
  // the provider is not down.
  if (answer.status === "invalid") return { provider, status: "missing", reason: reason ?? "invalid" };
  return { provider, status: "error", reason };
}
