import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants } from "node:fs";
import {
  open,
  realpath,
  mkdir,
  writeFile,
  rename,
  rm,
  lstat,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { FirstmateReleases } from "./firstmate-release.ts";

const files = ["captain.md", "captain-shared.md", "learnings.md"];
async function privateLocalRecord(path: string, max: number) {
  const f = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  ).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
  if (!f) return "";
  try {
    const stat = await f.stat();
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      stat.nlink !== 1 ||
      stat.size > max
    )
      throw Error("Unsafe crew record");
    const buf = Buffer.alloc(max + 1);
    const { bytesRead } = await f.read(buf, 0, buf.length, 0);
    if (bytesRead !== stat.size) throw Error("Crew record changed");
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await f.close();
  }
}

/** Local accounting only. No session or memory content is sent to a provider. */
export async function localStow(
  releases: FirstmateReleases,
  hasConversation: boolean,
) {
  const { home, revision } = await releases.crewHome(),
    git = dirname(home),
    owner = dirname(git);
  await releases.verifyHomes(revision, [home]);
  const data = join(home, "data");
  await mkdir(data, { recursive: true, mode: 0o700 });
  for (const dir of [data, join(home, "config")]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if ((await realpath(dir)) !== dir) throw Error("Unsafe crew directory");
  }
  const registry = await privateLocalRecord(
    join(data, "secondmates.md"),
    32768,
  );
  const homes = new Set<string>();
  for (const line of registry.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const row = /^- amun-(codex|claude) - .*?\(home: ([^;]+); scope: /.exec(
      line,
    );
    if (!row || row[2] !== join(git, row[1] + "-worker") || homes.has(row[2]))
      throw Error("Unverified secondmate registration");
    homes.add(row[2]);
  }
  if (homes.size) await releases.verifyHomes(revision, [...homes]);
  const env = {
    HOME: owner,
    FM_HOME: home,
    FM_ROOT_OVERRIDE: home,
    FM_BACKEND: "tmux",
    TMUX_TMPDIR: owner,
    PATH: "/usr/bin:/bin:/opt/homebrew/bin",
  };
  const run = async (script: string, args: string[], target = home) => {
    const r = await promisify(execFile)(
      "/bin/bash",
      [join(target, "bin", script), ...args],
      {
        cwd: target,
        env: { ...env, FM_HOME: target, FM_ROOT_OVERRIDE: target },
        timeout: 60000,
        maxBuffer: 65536,
      },
    );
    return r.stdout.trim();
  };
  const memory = await Promise.all(
    files.map((name) => privateLocalRecord(join(data, name), 65536)),
  );
  const backlog = await privateLocalRecord(join(data, "backlog.md"), 65536);
  await promisify(execFile)(
    "/bin/bash",
    [
      "-c",
      '. "$FM_HOME/bin/fm-startup-memory-budget-lib.sh" && fm_startup_memory_budget_materialize "$FM_HOME/config"',
    ],
    { cwd: home, env, timeout: 10000 },
  );
  const before = await run("fm-startup-memory-budget.sh", ["report"]);
  const hasFindings =
    hasConversation || memory.some((v) => v.trim()) || /^- \[/m.test(backlog);
  const workerBudgets = [];
  for (const worker of homes) {
    const budget = await run(
      "fm-startup-memory-budget.sh",
      ["report"],
      worker,
    ).catch(() => "Budget unavailable in this home.");
    workerBudgets.push(
      worker.slice(git.length + 1) + " · worker curation pending.\n" + budget,
    );
  }
  const cascade = homes.size
    ? workerBudgets.join("\n")
    : await run("fm-stow-cascade.sh", []);
  const after = await run("fm-startup-memory-budget.sh", ["report"]);
  const report = [
    "Startup memory",
    "Before\n" + before,
    "After\n" + after,
    ...files.map((name) => "data/" + name + " · unchanged"),
    cascade,
    hasFindings
      ? "Local accounting finished. Existing conversation, memory or backlog material still needs curation."
      : homes.size
        ? "Secondmate curation is open."
        : "The local sweep found no conversation, startup memory, backlog item or registered secondmate to curate.",
  ].join("\n\n");
  const receipt = join(data, "stow-receipt.md"),
    temp = join(data, ".stow-receipt-" + randomUUID());
  try {
    const old = await lstat(receipt).catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    if (old && (!old.isFile() || old.nlink !== 1))
      throw Error("Unexpected receipt destination");
    if ((await realpath(data)) !== data) throw Error("Crew directory changed");
    await writeFile(temp, report + "\n", {
      flag: "wx",
      mode: 0o600,
      flush: true,
    });
    await rename(temp, receipt);
  } finally {
    await rm(temp, { force: true });
  }
  return report;
}
