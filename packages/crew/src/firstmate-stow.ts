import { crewScope } from "./firstmate-dispatch.ts";
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

import { stowState, type StowMessage } from "../../contracts/src/stow.ts";
import {
  memoryFiles as files,
  ageLearnings,
  planStow,
  stowHash,
  type Memory,
} from "./stow-curation.ts";
import { inferStow } from "./stow-inference.ts";
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

async function replaceLocal(
  data: string,
  name: string,
  previous: string,
  next: string,
  max: number,
) {
  if (Buffer.byteLength(next) > max)
    throw Error("Local record exceeds its limit");
  const target = join(data, name),
    temp = join(data, ".stow-write-" + randomUUID());
  try {
    await writeFile(temp, next, { flag: "wx", mode: 0o600, flush: true });
    if (
      (await realpath(data)) !== data ||
      (await privateLocalRecord(target, max)) !== previous
    )
      throw Error("Crew record changed during Stow");
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true });
  }
}

async function retainArchive(
  data: string,
  aged: ReturnType<typeof ageLearnings>,
  date: string,
) {
  if (aged.archive.length) {
    const oldArchive = await privateLocalRecord(
      join(data, "memory-archive.md"),
      1048576,
    );
    const stored = new Set(oldArchive.split("\n"));
    const additions = aged.archive.filter((entry) => !stored.has(entry));
    if (additions.length)
      await replaceLocal(
        data,
        "memory-archive.md",
        oldArchive,
        oldArchive + "\n## " + date + "\n" + additions.join("\n") + "\n",
        1048576,
      );
  }
}

let running = false;
export async function localStow(
  releases: FirstmateReleases,
  messages: StowMessage[],
  action: string,
) {
  if (running) return "A local Stow pass is already running.";
  running = true;
  try {
    return await sweep(releases, messages, action);
  } finally {
    running = false;
  }
}
async function sweep(
  releases: FirstmateReleases,
  messages: StowMessage[],
  action: string,
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
    const row =
      /^- amun-(codex|claude) - [^()]+\(home: ([^;)]+); scope: [^()]*; projects: [^;()]*; added \d{4}-\d{2}-\d{2}\)$/.exec(
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
    TMUX_TMPDIR: homes.size ? (await crewScope(owner)).scope : owner,
    PATH: "/usr/bin:/bin:/opt/homebrew/bin",
  };
  const run = async (script: string, args: string[], target = home) => {
    const r = await promisify(execFile)(
      "/usr/bin/sandbox-exec",
      [
        "-p",
        '(version 1)(allow default)(deny network-outbound (remote ip "*:*"))',
        "/bin/bash",
        join(target, "bin", script),
        ...args,
      ],
      {
        cwd: target,
        env: { ...env, FM_HOME: target, FM_ROOT_OVERRIDE: target },
        timeout: 60000,
        maxBuffer: 65536,
      },
    );
    return r.stdout.trim();
  };
  const contents = await Promise.all(
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
  const memory = Object.fromEntries(
    files.map((name, i) => [name, contents[i]!]),
  ) as Memory;
  const source = messages.map((m) => m.text).join("\n"),
    date = new Date().toISOString().slice(0, 10);
  const info = await privateLocalRecord(
    join(data, "stow-decisions.json"),
    524288,
  );
  const state = stowState.parse(
    info ? JSON.parse(info) : { pins: [], settled: [], seen: "" },
  );
  const stamp = (m: Memory) =>
    stowHash(
      JSON.stringify([
        date,
        messages,
        m,
        backlog,
        before.match(/effective_budget_tokens=\d+/)?.[0],
      ]),
    );
  const view = (text: string, pins: typeof state.pins) => ({
    kind: "stow-review" as const,
    text,
    pins: pins.slice(0, 32).map(({ id, edit }) => ({
      id,
      file: edit.file,
      previous: edit.previous,
      proposed: edit.text,
    })),
  });
  let presented: typeof state.pins = [];
  let next = memory,
    detail = "Local sweep finished.";
  let reviewed = false;
  if (action === "review")
    return state.pins.length
      ? view("Review each pinned change.", state.pins)
      : "No pinned changes await review.";
  if (action) {
    const [choice, id] = action.split(" ");
    const pin = state.pins.find((p) => p.id === id);
    if (!pin || !["approve", "keep"].includes(choice!))
      return "This pinned decision is no longer pending.";
    if (choice === "approve") {
      const change = planStow(memory, [pin.edit], pin.edit.text, date, pin.id);
      if (
        change.memory[pin.edit.file] === memory[pin.edit.file] &&
        (memory[pin.edit.file].split("\n").includes(pin.edit.previous) ||
          !memory[pin.edit.file]
            .split("\n")
            .some(
              (l) =>
                l === "- " + pin.edit.text ||
                l.startsWith("- " + pin.edit.text + " <!--"),
            ))
      )
        return "The pinned entry changed. Run /stow again for a fresh review.";
      next = change.memory;
    }
    state.pins = state.pins.filter((p) => p.id !== id);
    state.settled.push(pin.id);
    detail =
      choice === "approve"
        ? "Saved your pinned-entry decision and applied the reviewed change."
        : "Saved your decision to keep the pinned entry.";
  } else if (state.seen === stamp(memory)) {
    detail = "Already reviewed locally. Previous decisions still apply.";
  } else {
    state.pins = state.pins.filter((p) =>
      memory[p.edit.file].split("\n").includes(p.edit.previous),
    );
    try {
      const edits = await inferStow(messages, memory, backlog, before);
      const planned = planStow(memory, edits, source, date);
      next = planned.memory;
      const fresh = planned.pins.filter(
        (p) =>
          !state.settled.includes(p.id) &&
          !state.pins.some((other) => other.id === p.id),
      );
      for (const pin of fresh)
        if (!state.pins.some((other) => other.id === pin.id))
          state.pins.push(pin);
      presented = fresh;
      detail = fresh.length
        ? "Review each pinned change."
        : "Local sweep finished.";
      reviewed = true;
    } catch {
      detail =
        "Local curation could not finish. Check Homebrew llama-completion, the installed LM Studio GGUF and the local context limit. No hosted fallback was used.";
    }
  }
  if (reviewed && !contents.some((v) => /Memory layering/i.test(v))) {
    const aged = ageLearnings(
      next["learnings.md"],
      source + "\n" + backlog,
      date,
    );
    await retainArchive(data, aged, date);
    if (aged.archive.length)
      detail += " Archived ordinary learnings: " + aged.archive.length + ".";
    next = { ...next, "learnings.md": aged.text };
  }
  const changes = files.filter((name) => next[name] !== memory[name]);
  for (const name of changes)
    await replaceLocal(data, name, memory[name], next[name], 65536);
  if (reviewed || (action && state.seen === stamp(memory)))
    state.seen = stamp(next);
  const encoded = JSON.stringify(state);
  if (encoded !== info)
    await replaceLocal(data, "stow-decisions.json", info, encoded, 524288);
  if (state.pins.length && !presented.length)
    detail +=
      " Pending pinned decisions: " + state.pins.length + ". Use /stow review.";
  const cascadeReport = await run("fm-stow-cascade.sh", []).catch(
    (e: { code?: number; stdout?: string }) => {
      if (e.code === 3 && typeof e.stdout === "string") return e.stdout;
      throw e;
    },
  );
  const workerBudgets: string[] = [];
  for (const worker of homes) {
    const stanza = cascadeReport
      .split(/\n\s*\n/)
      .find((block) => block.split("\n").includes("home=" + worker));
    const local = stanza?.split("\n") ?? [];
    if (
      !local.includes("transport=direct") ||
      !local.includes("budget_report=ok") ||
      !local.includes("placement=local")
    ) {
      workerBudgets.push(
        worker.slice(git.length + 1) +
          " · Local curation deferred. " +
          (local.find((l) => l.startsWith("reason=")) ??
            local.find((l) => l.startsWith("transport=")) ??
            "Unverified worker"),
      );
      continue;
    }
    const directory = join(worker, "data");
    try {
      if ((await realpath(directory)) !== directory) throw Error();
      const records = await Promise.all(
        files.map((f) => privateLocalRecord(join(directory, f), 65536)),
      );
      const raw = records[2]!,
        work = await privateLocalRecord(join(directory, "backlog.md"), 65536);
      const marker = await privateLocalRecord(
        join(directory, ".stow-local-pass"),
        128,
      );
      const fingerprint = (learnings: string) =>
        stowHash(
          JSON.stringify([date, records[0], records[1], learnings, work]),
        );
      if (
        marker !== fingerprint(raw) &&
        !records.some((v) => /Memory layering/i.test(v))
      ) {
        const aged = ageLearnings(raw, work, date);
        await retainArchive(directory, aged, date);
        if (raw !== aged.text)
          await replaceLocal(directory, "learnings.md", raw, aged.text, 65536);
        await replaceLocal(
          directory,
          ".stow-local-pass",
          marker,
          fingerprint(aged.text),
          128,
        );
      }
      const after = await run(
        "fm-startup-memory-budget.sh",
        ["report"],
        worker,
      );
      workerBudgets.push(
        "Curated inactive worker " +
          worker.slice(git.length + 1) +
          ".\nBefore\n" +
          local
            .filter((l) =>
              /^(file|effective_budget_tokens|total_estimated_tokens|budget_status)=/.test(
                l,
              ),
            )
            .join("\n") +
          "\nAfter\n" +
          after,
      );
    } catch {
      workerBudgets.push(
        worker.slice(git.length + 1) +
          " · Local curation incomplete. Worker records could not be verified.",
      );
    }
  }
  const cascade = homes.size ? workerBudgets.join("\n") : cascadeReport;
  const after = await run("fm-startup-memory-budget.sh", ["report"]);
  const report = [
    "Startup memory",
    "Before\n" + before,
    "After\n" + after,
    ...files.map(
      (name) =>
        "data/" +
        name +
        " · " +
        (changes.includes(name) ? "updated" : "unchanged"),
    ),
    cascade,
    detail,
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
    await writeFile(
      temp,
      report.replace(
        detail,
        state.pins.length
          ? "Pinned decisions pending: " + state.pins.length
          : detail,
      ) + "\n",
      {
        flag: "wx",
        mode: 0o600,
        flush: true,
      },
    );
    await rename(temp, receipt);
  } finally {
    await rm(temp, { force: true });
  }
  return presented.length ? view(report, presented) : report;
}
