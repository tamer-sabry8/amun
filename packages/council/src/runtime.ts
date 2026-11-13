// Council runtime on disk (Roast_Room_Integration_Plan.md §3, §6).
//
//   <root>/manifest.json      current + previous commit, checksum, validated-at
//   <root>/vendor/<commit>/   pristine upstream, never edited
//   <root>/staging/<commit>/  a downloaded update under validation
//   <root>/registry/          Amun-owned: advisors, board.json, disabled.json
//   <root>/runtime/<commit>/  composed working copy = upstream + registry
//   <root>/runtime/current    symlink to the composed copy in use
//   <root>/sessions/          councils; outside vendor, survive updates
//   <root>/bridge/            Chair questions waiting for the owner
//
// Layout inside a version follows upstream (nateherkai/roast-room): roster at
// .claude/skills/roast-room/roster.json, agents in .claude/agents, brains in
// .claude/skills/roast-room/brains/<slug>, the room app in app/.
//
// Nothing here edits upstream files: everything Amun-specific lives in the
// registry and is applied by composition.
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import {
  classifyUpdate,
  composeRoster,
  emptyManifest,
  executableChanges,
  missingCommands,
  promote,
  rollback as rollbackManifest,
  roomThemeCss,
  themeTokens,
  validateRoster,
  type CouncilManifest,
  type Registry,
  type Roster,
  type Seat,
} from "../../domain/src/work/council.ts";

export const skillPath = ".claude/skills/roast-room/SKILL.md";
export const rosterPath = ".claude/skills/roast-room/roster.json";
const agentPath = (key: string) => `.claude/agents/council-${key}.md`;
const brainPath = (slug: string) => `.claude/skills/roast-room/brains/${slug}`;
const commitPattern = /^[a-f0-9]{7,40}$/;

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );
async function json<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}
async function writeJson(path: string, value: unknown) {
  const temp = path + ".tmp";
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n");
  await rename(temp, path);
}

export const readManifest = (root: string) =>
  json<CouncilManifest>(join(root, "manifest.json"), emptyManifest);
export async function writeManifest(root: string, manifest: CouncilManifest) {
  await mkdir(root, { recursive: true });
  await writeJson(join(root, "manifest.json"), manifest);
}

/** Every regular file under a directory, as sorted relative paths. */
export async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) out.push(relative(dir, path));
    }
  };
  if (await exists(dir)) await walk(dir);
  return out.sort();
}
/** One checksum for a whole tree: paths and contents, in a stable order. */
export async function checksum(dir: string) {
  const hash = createHash("sha256");
  for (const file of await files(dir)) {
    hash.update(file + "\0");
    hash.update(await readFile(join(dir, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function readRegistry(root: string): Promise<Registry> {
  const base = join(root, "registry");
  const advisors: Seat[] = [];
  const dir = join(base, "advisors");
  if (await exists(dir))
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (!entry.isDirectory()) continue;
      const seat = await json<Seat | null>(
        join(dir, entry.name, "advisor.json"),
        null,
      );
      if (seat && typeof seat.key === "string" && typeof seat.slug === "string")
        advisors.push(seat);
    }
  const disabled = await json<unknown>(join(base, "disabled.json"), []);
  return {
    advisors,
    disabled: Array.isArray(disabled) ? disabled.map(String) : [],
    board: await json<Registry["board"]>(join(base, "board.json"), null),
  };
}
export async function setSeatDisabled(
  root: string,
  key: string,
  disabled: boolean,
) {
  const base = join(root, "registry");
  await mkdir(base, { recursive: true });
  const current = (await readRegistry(root)).disabled.filter(
    (item) => item !== key,
  );
  await writeJson(
    join(base, "disabled.json"),
    disabled ? [...current, key].sort() : current,
  );
}

export interface Validation {
  problems: string[];
  roster: Roster | null;
}
/** Checks a composed (or candidate) directory before it may be used. */
export async function validate(
  dir: string,
  options: { tokensCss?: string; themes?: string[] } = {},
): Promise<Validation> {
  const roster = await json<Roster | null>(join(dir, rosterPath), null);
  if (!roster)
    return {
      problems: ["The roster file is missing or unreadable."],
      roster: null,
    };
  const present = new Set(await files(dir));
  const problems = validateRoster(roster, {
    agent: (key) => present.has(agentPath(key)),
    brain: (slug) =>
      [...present].some((file) => file.startsWith(brainPath(slug) + "/")),
  });
  const skill = await readFile(join(dir, skillPath), "utf8").catch(() => null);
  if (skill === null) problems.push("The Council skill file is missing.");
  else {
    if (!/^---\n[\s\S]*?\n---/.test(skill))
      problems.push("The Council skill has no readable front matter.");
    const missing = missingCommands(skill);
    if (missing.length)
      problems.push(
        `The Council skill no longer mentions: ${missing.join(", ")}.`,
      );
  }
  if (!present.has("app/server.mjs"))
    problems.push("The room server is missing.");
  if (options.tokensCss)
    for (const theme of options.themes ?? [])
      for (const token of roomThemeCss(themeTokens(options.tokensCss, theme))
        .missing)
        problems.push(`Theme "${theme}" has no value for ${token}.`);
  return { problems, roster };
}

/**
 * Composes upstream + registry into runtime/<commit> and points
 * runtime/current at it. A pure function of its inputs: rerun on every
 * update or registry change. The vendor copy is never written to.
 */
export async function compose(
  root: string,
  commit: string,
  options: { tokensCss?: string; themes?: string[]; activate?: boolean } = {},
): Promise<Validation & { dir: string }> {
  if (!commitPattern.test(commit)) throw Error("Invalid commit");
  const vendor = join(root, "vendor", commit);
  if (!(await exists(join(vendor, rosterPath))))
    return {
      problems: ["That version is not installed."],
      roster: null,
      dir: "",
    };
  // A corrupt upstream roster is a readable problem, never a crash.
  const upstream = await json<Roster | null>(join(vendor, rosterPath), null);
  if (!upstream || !Array.isArray(upstream.seats))
    return {
      problems: ["The roster file is missing or unreadable."],
      roster: null,
      dir: "",
    };
  const registry = await readRegistry(root);
  const building = join(root, "runtime", `${commit}.building`);
  const target = join(root, "runtime", commit);
  await rm(building, { recursive: true, force: true });
  await mkdir(join(root, "runtime"), { recursive: true });
  await cp(vendor, building, { recursive: true });
  await writeJson(
    join(building, rosterPath),
    composeRoster(upstream, registry),
  );
  for (const seat of registry.advisors) {
    const source = join(root, "registry", "advisors", seat.key);
    if (await exists(join(source, "agent.md"))) {
      await mkdir(join(building, ".claude/agents"), { recursive: true });
      await cp(join(source, "agent.md"), join(building, agentPath(seat.key)));
    }
    if (await exists(join(source, "brain")))
      await cp(join(source, "brain"), join(building, brainPath(seat.slug)), {
        recursive: true,
      });
    if (await exists(join(source, "portraits")))
      await cp(
        join(source, "portraits"),
        join(building, "app/public/portraits"),
        {
          recursive: true,
        },
      );
  }
  // Sessions live outside the composed copy so they survive every update.
  await mkdir(join(root, "sessions"), { recursive: true });
  await rm(join(building, "sessions"), { recursive: true, force: true });
  await symlink(join(root, "sessions"), join(building, "sessions"));
  const checked = await validate(building, options);
  if (checked.problems.length) {
    await rm(building, { recursive: true, force: true });
    return { ...checked, dir: "" };
  }
  await rm(target, { recursive: true, force: true });
  await rename(building, target);
  if (options.activate !== false) {
    // Swap the pointer atomically: build the new link, then rename over it.
    const link = join(root, "runtime", "current");
    const next = link + ".next";
    await rm(next, { force: true });
    await symlink(target, next);
    await rename(next, link);
  }
  return { ...checked, dir: target };
}

export interface Fetcher {
  /** The newest upstream commit. */
  head(): Promise<string>;
  /** Places that commit's files in `destination`. */
  download(commit: string, destination: string): Promise<void>;
  /** The Node range upstream asks for, if it says. */
  requiredNode?(directory: string): Promise<string | null>;
}
export type UpdateResult =
  | { state: "current" }
  | { state: "rejected"; commit: string; problems: string[] }
  | {
      state: "applied";
      commit: string;
      restart: "reload" | "restart";
      reasons: string[];
      changedFiles: string[];
      executable: string[];
    };

async function changedBetween(before: string, after: string) {
  const [old, next] = await Promise.all([files(before), files(after)]);
  const changed = new Set<string>();
  for (const file of new Set([...old, ...next])) {
    const [a, b] = await Promise.all([
      readFile(join(before, file)).catch(() => null),
      readFile(join(after, file)).catch(() => null),
    ]);
    if (a === null || b === null || !a.equals(b)) changed.add(file);
  }
  return [...changed].sort();
}

/**
 * Weekly update: stage, validate against the user's own registry, and only
 * then switch. A failed candidate leaves the current runtime untouched; the
 * previous version is always kept for rollback.
 */
export async function update(
  root: string,
  fetcher: Fetcher,
  options: {
    bundledNode: string;
    tokensCss?: string;
    themes?: string[];
    now?: Date;
  },
): Promise<UpdateResult> {
  const now = (options.now ?? new Date()).toISOString();
  const manifest = await readManifest(root);
  const commit = await fetcher.head();
  if (!commitPattern.test(commit))
    throw Error("Upstream returned an invalid commit");
  if (manifest.current?.commit === commit) {
    await writeManifest(root, { ...manifest, lastCheckedAt: now });
    return { state: "current" };
  }
  const staging = join(root, "staging", commit);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  const reject = async (problems: string[]): Promise<UpdateResult> => {
    await rm(staging, { recursive: true, force: true });
    await rm(join(root, "vendor", commit), { recursive: true, force: true });
    await writeManifest(root, { ...manifest, lastCheckedAt: now });
    return { state: "rejected", commit, problems };
  };
  try {
    await fetcher.download(commit, staging);
  } catch (error) {
    return reject([
      "The update could not be downloaded: " +
        (error instanceof Error ? error.message : "unknown error"),
    ]);
  }
  const sha256 = await checksum(staging);
  // Validate the candidate composed with this user's registry, without
  // activating it, so a broken update can never become the runtime in use.
  await mkdir(join(root, "vendor"), { recursive: true });
  await rm(join(root, "vendor", commit), { recursive: true, force: true });
  await cp(staging, join(root, "vendor", commit), { recursive: true });
  const candidate = await compose(root, commit, {
    ...options,
    activate: false,
  });
  if (candidate.problems.length) return reject(candidate.problems);
  const previous = manifest.current
    ? join(root, "vendor", manifest.current.commit)
    : null;
  const changedFiles = previous
    ? await changedBetween(previous, join(root, "vendor", commit))
    : await files(join(root, "vendor", commit));
  const restart = classifyUpdate({
    changedFiles,
    requiredNode: (await fetcher.requiredNode?.(staging)) ?? null,
    bundledNode: options.bundledNode,
  });
  const activated = await compose(root, commit, options);
  if (activated.problems.length) return reject(activated.problems);
  await rm(staging, { recursive: true, force: true });
  await writeManifest(root, {
    ...promote(manifest, { commit, sha256 }, now),
    lastCheckedAt: now,
  });
  return {
    state: "applied",
    commit,
    restart: restart.class,
    reasons: restart.reasons,
    changedFiles,
    executable: executableChanges(changedFiles),
  };
}

/** Returns to the previous validated version, if one is kept. */
export async function rollback(
  root: string,
  options: { tokensCss?: string; themes?: string[] } = {},
) {
  const manifest = await readManifest(root);
  const next = rollbackManifest(manifest);
  if (!next?.current)
    return {
      ok: false as const,
      problems: ["There is no earlier version to return to."],
    };
  const composed = await compose(root, next.current.commit, options);
  if (composed.problems.length)
    return { ok: false as const, problems: composed.problems };
  await writeManifest(root, next);
  return { ok: true as const, commit: next.current.commit };
}

/** The roster in use, with the user's disabled upstream seats marked. */
export async function seats(root: string) {
  const manifest = await readManifest(root);
  if (!manifest.current) return [];
  const upstream = await json<Roster | null>(
    join(root, "vendor", manifest.current.commit, rosterPath),
    null,
  );
  const registry = await readRegistry(root);
  return [
    ...(upstream?.seats ?? []).map((seat) => ({
      key: seat.key,
      name: seat.name,
      disabled: registry.disabled.includes(seat.key),
    })),
    ...registry.advisors.map((seat) => ({
      key: seat.key,
      name: seat.name,
      disabled: false,
    })),
  ];
}

export interface Pin {
  repository: string;
  commit: string;
  sha256: string;
}
/**
 * First run: installs the version that ships with Amun. `staged` is the
 * pinned upstream, already checksum-verified when it was staged at build time.
 * A user who already has a version (for example a newer validated update)
 * keeps it.
 */
export async function install(
  root: string,
  staged: string,
  pin: Pin,
  options: { tokensCss?: string; themes?: string[]; now?: Date } = {},
) {
  const manifest = await readManifest(root);
  const repo = pin.repository.replace(/^https:\/\/github\.com\//, "");
  if (manifest.current) {
    if (!manifest.repo) await writeManifest(root, { ...manifest, repo });
    return { installed: false as const, problems: [] as string[] };
  }
  if (!(await exists(join(staged, rosterPath))))
    return {
      installed: false as const,
      problems: ["The Council’s advisors were not included in this build."],
    };
  await mkdir(join(root, "vendor"), { recursive: true });
  const vendor = join(root, "vendor", pin.commit);
  await rm(vendor, { recursive: true, force: true });
  await cp(staged, vendor, { recursive: true });
  const composed = await compose(root, pin.commit, options);
  if (composed.problems.length) {
    await rm(vendor, { recursive: true, force: true });
    return { installed: false as const, problems: composed.problems };
  }
  await writeManifest(root, {
    repo,
    current: {
      commit: pin.commit,
      sha256: pin.sha256,
      validatedAt: (options.now ?? new Date()).toISOString(),
    },
    previous: null,
    lastCheckedAt: null,
  });
  return { installed: true as const, problems: [] as string[] };
}
