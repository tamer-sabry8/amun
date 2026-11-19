import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { strToU8, zipSync, type Zippable } from "fflate";
import type { Redactor } from "@amun/work-store";

const run = promisify(execFile);

/** Largest slice kept from any one file; longer files keep their newest end. */
export const TRACE_FILE_LIMIT = 2 * 1024 * 1024;

/** Firstmate state files worth reading, matched against top-level names in state/. */
const STATE_FILE = /^(?:[\w.-]+\.(?:meta|status|json|jsonl|log)|\.wake-queue|\.afk)$/;
/** Firstmate data files about the fleet and its work (never extensions or secrets). */
const DATA_FILES = ["backlog.md", "secondmates.md", "projects.md", "done-archive.md"];
const MATE_FILES = ["status.log", "report.md", "brief.md", "dispatch-resolution.json"];

export interface TraceBundleInput {
  amunHome: string;
  /** The captain's Firstmate home; read only. */
  fmHome: string;
  traceDir: string;
  redactor: Redactor;
  /** The Paseo daemon log, when known. */
  daemonLog?: string | null;
  /** More text files for the zip, by name; each passes the redactor. */
  extra?: Record<string, string>;
  /** Amun build and Firstmate versions for the manifest. */
  versions?: Record<string, string>;
  now?: Date;
}

export interface TraceBundle {
  fileName: string;
  path: string;
  bytes: Uint8Array;
  files: string[];
  skipped: { path: string; reason: string }[];
}

async function readTail(file: string): Promise<{ text: string; cut: boolean }> {
  const size = statSync(file).size;
  const start = Math.max(0, size - TRACE_FILE_LIMIT);
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    return { text: buffer.toString("utf8"), cut: start > 0 };
  } finally {
    await handle.close();
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run("git", ["-C", cwd, ...args], { timeout: 10_000 });
    return stdout;
  } catch (error) {
    return `git ${args.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}\n`;
  }
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Builds the zip the captain downloads and uploads when something goes wrong:
 * Amun's own trace (chats, RPC calls, connection checks), a read-only copy of
 * the Firstmate files that say what each agent did and why it is blocked, git
 * worktrees and branches, and the daemon log. Every text passes the redactor.
 * Nothing in the Firstmate home is written or changed.
 */
export async function buildTraceBundle(input: TraceBundleInput): Promise<TraceBundle> {
  const now = input.now ?? new Date();
  const zip: Zippable = {};
  const files: string[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const add = (name: string, text: string) => {
    zip[name] = strToU8(input.redactor.text(text));
    files.push(name);
  };
  const addFile = async (name: string, file: string) => {
    if (!existsSync(file)) return;
    try {
      const { text, cut } = await readTail(file);
      add(name, cut ? `[older lines cut; newest ${TRACE_FILE_LIMIT} bytes kept]\n${text}` : text);
    } catch (error) {
      skipped.push({ path: name, reason: error instanceof Error ? error.message : String(error) });
    }
  };

  for (const name of listFiles(input.traceDir).filter((file) => file.endsWith(".jsonl")))
    await addFile(`amun/trace/${name}`, path.join(input.traceDir, name));
  for (const name of listFiles(path.join(input.amunHome, "products")))
    await addFile(`amun/products/${name}`, path.join(input.amunHome, "products", name));
  // Connection records hold addresses and user names only; tokens live in Keychain.
  await addFile("amun/connections.json", path.join(input.amunHome, "connections.json"));

  const state = path.join(input.fmHome, "state");
  for (const name of listFiles(state)) {
    if (STATE_FILE.test(name)) await addFile(`firstmate/state/${name}`, path.join(state, name));
    else skipped.push({ path: `firstmate/state/${name}`, reason: "not a status file" });
  }
  const data = path.join(input.fmHome, "data");
  for (const name of DATA_FILES)
    await addFile(`firstmate/data/${name}`, path.join(data, name));
  for (const mate of listDirs(data))
    for (const name of MATE_FILES)
      await addFile(`firstmate/data/${mate}/${name}`, path.join(data, mate, name));
  const config = path.join(input.fmHome, "config");
  add(
    "firstmate/config-flags.txt",
    ["fleet-ledger", "status-archive", "backend"]
      .map((flag) => `${flag}: ${existsSync(path.join(config, flag)) ? "on" : "off"}`)
      .join("\n") + "\n",
  );

  add("git/worktrees.txt", await git(input.fmHome, ["worktree", "list", "--porcelain"]));
  add("git/branches.txt", await git(input.fmHome, ["branch", "-vv", "--all"]));
  add("git/status.txt", await git(input.fmHome, ["status", "--short", "--branch"]));

  if (input.daemonLog) await addFile("daemon/daemon.log", input.daemonLog);
  for (const [name, text] of Object.entries(input.extra ?? {})) add(name, text);

  add(
    "manifest.json",
    JSON.stringify(
      {
        created: now.toISOString(),
        fmHome: input.fmHome,
        versions: input.versions ?? {},
        files: [...files, "manifest.json"],
        skipped,
        note: "Secrets are redacted. Firstmate files are copied read-only.",
      },
      null,
      2,
    ),
  );

  const bytes = zipSync(zip, { level: 6 });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const fileName = `amun-trace-${stamp}.zip`;
  const exports = path.join(input.amunHome, "trace-exports");
  mkdirSync(exports, { recursive: true });
  const target = path.join(exports, fileName);
  writeFileSync(target, bytes, { mode: 0o600 });
  return { fileName, path: target, bytes, files, skipped };
}
