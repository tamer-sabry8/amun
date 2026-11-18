import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  fleetSnapshotSchema,
  type BacklogRecord,
  type BoardColumn,
  type CaptainHold,
  type FleetSnapshot,
} from "@getpaseo/protocol/amun-rpc";

const run = promisify(execFile);

export interface FirstmateHome {
  /** Vendored code root (FM_ROOT_OVERRIDE). */
  root: string;
  /** Operational home of one Product Space (FM_HOME). */
  fmHome: string;
}

export class FirstmateScriptError extends Error {
  constructor(
    public readonly script: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(`${script} failed (exit ${exitCode ?? "signal"}): ${stderr.trim().slice(0, 500)}`);
    this.name = "FirstmateScriptError";
  }
}

/**
 * Environment every Firstmate script and the primary session share: an explicit
 * FM_HOME (fm-send.sh refuses without one), the code root, and the code root's
 * bin/ ahead of the user's PATH so treehouse/tasks-axi stay discoverable.
 */
export function firstmateEnv(
  home: FirstmateHome,
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) if (value !== undefined) env[key] = value;
  env.FM_HOME = home.fmHome;
  env.FM_ROOT_OVERRIDE = home.root;
  env.PATH = [path.join(home.root, "bin"), base.PATH ?? ""].filter(Boolean).join(path.delimiter);
  return env;
}

async function script(
  home: FirstmateHome,
  name: string,
  args: string[],
  timeoutMs = 60_000,
): Promise<string> {
  const file = path.join(home.root, "bin", name);
  try {
    const { stdout } = await run(file, args, {
      cwd: home.root,
      env: firstmateEnv(home),
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const failure = error as { code?: number | null; stderr?: string };
    throw new FirstmateScriptError(name, failure.code ?? null, failure.stderr ?? String(error));
  }
}

const FLEET_SNAPSHOT_TIMEOUT_MS = 5 * 60_000;

/** bin/fm-fleet-snapshot.sh --json (schema fm-fleet-snapshot.v1). Read-only by contract. */
export async function readFleetSnapshot(home: FirstmateHome): Promise<FleetSnapshot> {
  // A busy home takes minutes; callers share one run (shareFleetSnapshots).
  const stdout = await script(home, "fm-fleet-snapshot.sh", ["--json"], FLEET_SNAPSHOT_TIMEOUT_MS);
  return fleetSnapshotSchema.parse(JSON.parse(stdout));
}

export interface SharedFleetSnapshots {
  /**
   * The last snapshot at once when there is one (refreshed behind it). With
   * none yet, waits only briefly for the read that is running: the screen is
   * never held for a slow home.
   */
  read(fmHome: string): Promise<FleetSnapshot>;
  /** A fresh snapshot, sharing any read already running. */
  readFresh(fmHome: string): Promise<FleetSnapshot>;
}

/** The first snapshot of a busy home is still being read. */
export class FleetSnapshotNotReadyError extends Error {
  constructor() {
    super("Firstmate is still reading the fleet. It will show here in a moment.");
    this.name = "FleetSnapshotNotReadyError";
  }
}

export interface ShareFleetSnapshotsOptions {
  /** A snapshot is reused for at least this long. */
  freshMs?: number;
  /** How long `read` waits for the very first snapshot before giving way. */
  firstWaitMs?: number;
  now?: () => number;
}

interface SharedFleetSnapshotEntry {
  inFlight: Promise<FleetSnapshot> | null;
  value: FleetSnapshot | null;
  /** The value is reused until this time. */
  freshUntil: number;
}

/**
 * One fm-fleet-snapshot.sh run per home at a time. On a busy home the script
 * takes minutes, and the 5 s poll plus every UI refresh each used to start
 * their own copy: runs piled up, starved each other past the timeout and none
 * ever finished, while the screen waited on them. Now callers share the
 * running read and the last good snapshot; a read is followed by a rest at
 * least as long as it took, so a slow home is not read back to back; and
 * nothing on screen waits for the first one.
 */
export function shareFleetSnapshots(
  readOnce: (fmHome: string) => Promise<FleetSnapshot>,
  options: ShareFleetSnapshotsOptions = {},
): SharedFleetSnapshots {
  const freshMs = options.freshMs ?? 5_000;
  const firstWaitMs = options.firstWaitMs ?? 2_000;
  const now = options.now ?? Date.now;
  const entries = new Map<string, SharedFleetSnapshotEntry>();
  function entryFor(fmHome: string): SharedFleetSnapshotEntry {
    let entry = entries.get(fmHome);
    if (!entry) {
      entry = { inFlight: null, value: null, freshUntil: 0 };
      entries.set(fmHome, entry);
    }
    return entry;
  }
  function readFresh(fmHome: string): Promise<FleetSnapshot> {
    const entry = entryFor(fmHome);
    if (entry.inFlight) return entry.inFlight;
    if (entry.value && now() < entry.freshUntil) return Promise.resolve(entry.value);
    const started = now();
    const running = readOnce(fmHome)
      .then((snapshot) => {
        entry.value = snapshot;
        entry.freshUntil = now() + Math.max(freshMs, now() - started);
        return snapshot;
      })
      .finally(() => {
        entry.inFlight = null;
      });
    entry.inFlight = running;
    return running;
  }
  return {
    readFresh,
    read(fmHome) {
      const entry = entryFor(fmHome);
      const running = readFresh(fmHome);
      if (entry.value) {
        // Answer now; a stale snapshot is refreshed behind the caller.
        void running.catch(() => {});
        return Promise.resolve(entry.value);
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const giveWay = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new FleetSnapshotNotReadyError()), firstWaitMs);
      });
      // The read carries on behind a caller that gave way.
      void running.catch(() => {});
      return Promise.race([running, giveWay]).finally(() => clearTimeout(timer));
    },
  };
}

/**
 * Captain holds come from two places in the snapshot: backlog rows that are
 * captain_actionable (bin/fm-captain-hold.sh hold), and keyed needs-decision /
 * blocked events folded by fm-classify-lib.sh into tasks[].hints.open_decisions.
 */
export function holdsFromSnapshot(snapshot: FleetSnapshot): CaptainHold[] {
  const holds: CaptainHold[] = [];
  for (const record of snapshot.backlog.records) {
    if (!record.captain_actionable || !record.id) continue;
    holds.push({
      source: "backlog",
      taskId: record.id,
      title: record.title ?? record.id,
      reason: record.hold_reason ?? "",
      until: record.hold_until ?? null,
    });
  }
  for (const task of snapshot.tasks) {
    for (const decision of task.hints?.open_decisions ?? []) {
      if (decision.verb !== "needs-decision" && decision.verb !== "blocked") continue;
      holds.push({
        source: "crew",
        taskId: task.id,
        key: decision.key,
        verb: decision.verb,
        summary: decision.summary,
      });
    }
  }
  return holds;
}

const DISCOVERY_KINDS = new Set(["scout", "discovery", "research"]);
const SPEC_KINDS = new Set(["prd", "spec", "prototype", "wireframe", "story"]);

/**
 * tasks-axi has three states (In flight, Queued, Done). Amun's six columns are
 * derived from state plus kind, holds and PR links. Firstmate stays the writer.
 */
export function boardColumnFor(record: BacklogRecord): BoardColumn {
  const kind = (record.kind ?? "").toLowerCase();
  switch (record.state) {
    case "done":
      return "done";
    case "in_flight":
      return record.pr_url || record.captain_actionable ? "review" : "in_progress";
    default:
      if (DISCOVERY_KINDS.has(kind)) return "discovery";
      if (SPEC_KINDS.has(kind)) return "spec";
      return "backlog";
  }
}

/**
 * Default hold route: the captain's answer goes to the First Mate, which owns
 * fm-send.sh and fm-captain-hold.sh (AGENTS.md: the UI never bypasses Firstmate).
 */
export function holdAnswerPrompt(hold: CaptainHold, answer: string): string {
  if (hold.source === "backlog") {
    return [
      `Captain's answer for the held task ${hold.taskId} ("${hold.title}").`,
      `Question: ${hold.reason}`,
      `Answer: ${answer}`,
      "Record it with bin/fm-captain-hold.sh answer and continue.",
    ].join("\n");
  }
  return [
    `Captain's answer for ${hold.taskId}, open ${hold.verb} "${hold.key}": ${hold.summary}`,
    `Answer: ${answer}`,
    `Relay it with bin/fm-send.sh ${hold.taskId} --resolve-key ${hold.key} and continue supervising.`,
  ].join("\n");
}

/**
 * Direct route, off by default. Kept for a future captain-approved setting.
 */
export async function answerHoldDirect(
  home: FirstmateHome,
  hold: CaptainHold,
  answer: string,
): Promise<void> {
  if (hold.source === "crew") {
    await script(home, "fm-send.sh", [hold.taskId, "--resolve-key", hold.key, answer]);
    return;
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "amun-decision-"));
  try {
    const file = path.join(dir, "decision.md");
    await writeFile(file, `${answer}\n`);
    await script(home, "fm-captain-hold.sh", ["answer", hold.taskId, "--decision-file", file]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The tail of a crewmate's session, read-only, through Firstmate's fm-peek.sh. */
export async function peekCrew(home: FirstmateHome, taskId: string, lines = 80): Promise<string> {
  return script(home, "fm-peek.sh", [taskId, String(lines)], 15_000);
}
