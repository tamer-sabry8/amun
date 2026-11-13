import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Graphics run inside the main process to stay within the memory budget: one
// fewer process holding its own copy of the framework. The cost is that a
// graphics failure ends the app rather than restarting graphics alone, so a
// launch that follows an unclean exit goes back to the separate process.
export type GraphicsMode = "in-process" | "separate";
export type GraphicsState = {
  version: string;
  mode: GraphicsMode;
  running: boolean;
  failures: number;
};
// Unclean in-process exits tolerated before this version stays separate.
export const stickyAfter = 2;

function parse(value: unknown): GraphicsState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { version, mode, running, failures } = value as Record<string, unknown>;
  if (
    typeof version !== "string" ||
    (mode !== "in-process" && mode !== "separate") ||
    typeof running !== "boolean" ||
    typeof failures !== "number" ||
    !Number.isInteger(failures) ||
    failures < 0
  )
    return undefined;
  return { version, mode, running, failures };
}

/** Decide this launch's mode from what the previous launch left behind. */
export function planGraphics(
  previous: unknown,
  version: string,
  forceSeparate = false,
): GraphicsState {
  const last = parse(previous);
  const sameVersion = last?.version === version;
  const crashed =
    sameVersion && last.running === true && last.mode === "in-process";
  const failures = (sameVersion ? last.failures : 0) + (crashed ? 1 : 0);
  const mode: GraphicsMode =
    forceSeparate || crashed || failures >= stickyAfter
      ? "separate"
      : "in-process";
  return { version, mode, running: true, failures };
}

/** A clean exit of an in-process run clears earlier doubts about it. */
export function afterCleanExit(state: GraphicsState): GraphicsState {
  return {
    ...state,
    running: false,
    failures: state.mode === "in-process" ? 0 : state.failures,
  };
}

export function readGraphicsState(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

export function writeGraphicsState(file: string, state: GraphicsState): void {
  mkdirSync(dirname(file), { recursive: true });
  const draft = `${file}.${process.pid}.tmp`;
  writeFileSync(draft, JSON.stringify(state));
  renameSync(draft, file);
}
