import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface GitOptions {
  /** Used for commits a rebase or cherry-pick creates when none is configured. */
  identity?: { name: string; email: string };
}

interface Result {
  code: number;
  out: string;
  err: string;
}

async function run(
  cwd: string,
  args: string[],
  options: GitOptions = {},
): Promise<Result> {
  // Global and system configuration are ignored, so an identity is always supplied.
  const who = options.identity ?? { name: "Amun", email: "amun@localhost" };
  const identity = [
    "-c",
    "user.name=" + who.name,
    "-c",
    "user.email=" + who.email,
  ];
  try {
    const { stdout, stderr } = await exec(
      "/usr/bin/git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "commit.gpgsign=false",
        ...identity,
        ...args,
      ],
      {
        cwd,
        maxBuffer: 16 * 1024 * 1024,
        timeout: 120000,
        env: {
          PATH: "/usr/bin:/bin",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
          GIT_EDITOR: "true",
          LC_ALL: "C",
        },
      },
    );
    return { code: 0, out: stdout.trimEnd(), err: stderr.trimEnd() };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    if (typeof failure.code !== "number") throw error;
    return {
      code: failure.code,
      out: (failure.stdout ?? "").trimEnd(),
      err: (failure.stderr ?? "").trimEnd(),
    };
  }
}

async function git(
  cwd: string,
  args: string[],
  options?: GitOptions,
): Promise<string> {
  const result = await run(cwd, args, options);
  if (result.code !== 0)
    throw Error(
      `git ${args[0]} failed: ${result.err.split("\n")[0] ?? "unknown error"}`,
    );
  return result.out;
}

function assertRef(name: string): void {
  if (
    !name ||
    name.startsWith("-") ||
    name.length > 200 ||
    /[\s~^:?*[\\\0]|\.\.|@\{|\/\/|\.lock$|\/$/.test(name)
  )
    throw Error("Invalid branch or commit name");
}

export interface BranchNode {
  name: string;
  sha: string;
  /** The branch this one grew from: the base, or a branch it is stacked on. */
  parent: string | null;
  ahead: number;
  behind: number;
  /** Where the branch is checked out, if it has a worktree. */
  worktree: string | null;
  isBase: boolean;
}

/** Local branches with their lineage relative to a base branch. */
export async function branchGraph(
  repo: string,
  base: string,
): Promise<BranchNode[]> {
  assertRef(base);
  const refs = (
    await git(repo, [
      "for-each-ref",
      "--format=%(refname:short)%09%(objectname)",
      "refs/heads",
    ])
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, sha] = line.split("\t") as [string, string];
      return { name, sha };
    });
  if (!refs.some((ref) => ref.name === base))
    throw Error("Unknown base branch");
  const worktrees = new Map<string, string>();
  let path = "";
  for (const line of (
    await git(repo, ["worktree", "list", "--porcelain"])
  ).split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice(9);
    if (line.startsWith("branch refs/heads/"))
      worktrees.set(line.slice(18), path);
  }
  const counts = new Map<string, { ahead: number; behind: number }>();
  for (const ref of refs) {
    const [behind, ahead] = (
      await git(repo, [
        "rev-list",
        "--left-right",
        "--count",
        `${base}...${ref.name}`,
      ])
    )
      .split(/\s+/)
      .map(Number) as [number, number];
    counts.set(ref.name, { ahead, behind });
  }
  const nodes: BranchNode[] = [];
  for (const ref of refs) {
    const own = counts.get(ref.name)!;
    let parent: string | null = ref.name === base ? null : base;
    let best = 0;
    if (ref.name !== base)
      for (const other of refs) {
        const ahead = counts.get(other.name)!.ahead;
        // A branch is stacked on another when that tip is in its history
        // and carries commits the base does not have.
        if (
          other.name === ref.name ||
          other.name === base ||
          other.sha === ref.sha
        )
          continue;
        if (ahead <= best || ahead >= own.ahead) continue;
        const inside = await run(repo, [
          "merge-base",
          "--is-ancestor",
          other.sha,
          ref.sha,
        ]);
        if (inside.code === 0) {
          parent = other.name;
          best = ahead;
        }
      }
    nodes.push({
      name: ref.name,
      sha: ref.sha,
      parent,
      ahead: own.ahead,
      behind: own.behind,
      worktree: worktrees.get(ref.name) ?? null,
      isBase: ref.name === base,
    });
  }
  return nodes.sort(
    (a, b) =>
      Number(b.isBase) - Number(a.isBase) || a.name.localeCompare(b.name),
  );
}

export interface ConflictProjection {
  /** True when merging upstream into the branch would conflict. */
  conflicts: boolean;
  conflictedFiles: string[];
  upstreamChanged: string[];
  localChanged: string[];
  /** Files both sides changed, whether or not they collide. */
  bothChanged: string[];
  mergeBase: string;
  upstreamSha: string;
  branchSha: string;
}

/**
 * Projects a merge without touching any branch or working tree, so a
 * conflict is known before anyone pushes or merges.
 */
export async function conflictRadar(
  repo: string,
  branch: string,
  upstream: string,
): Promise<ConflictProjection> {
  assertRef(branch);
  assertRef(upstream);
  const [branchSha, upstreamSha] = await Promise.all([
    git(repo, ["rev-parse", "--verify", branch + "^{commit}"]),
    git(repo, ["rev-parse", "--verify", upstream + "^{commit}"]),
  ]);
  const mergeBase = await git(repo, ["merge-base", branchSha, upstreamSha]);
  const names = async (to: string) =>
    (await git(repo, ["diff", "--name-only", mergeBase, to]))
      .split("\n")
      .filter(Boolean);
  const [upstreamChanged, localChanged] = await Promise.all([
    names(upstreamSha),
    names(branchSha),
  ]);
  const merge = await run(repo, [
    "merge-tree",
    "--write-tree",
    "--name-only",
    branchSha,
    upstreamSha,
  ]);
  if (merge.code !== 0 && merge.code !== 1)
    throw Error("git merge-tree failed: " + (merge.err.split("\n")[0] ?? ""));
  // Output: the tree id, then conflicted paths, a blank line, then messages.
  const conflictedFiles =
    merge.code === 1
      ? (merge.out.split("\n\n")[0] ?? "").split("\n").slice(1).filter(Boolean)
      : [];
  return {
    conflicts: merge.code === 1,
    conflictedFiles: [...new Set(conflictedFiles)].sort(),
    upstreamChanged,
    localChanged,
    bothChanged: upstreamChanged.filter((file) => localChanged.includes(file)),
    mergeBase,
    upstreamSha,
    branchSha,
  };
}

/** The three versions of a conflicted file, for an agent to reconcile. */
export async function conflictVersions(
  repo: string,
  projection: ConflictProjection,
  file: string,
): Promise<{
  base: string | null;
  upstream: string | null;
  local: string | null;
}> {
  if (!projection.conflictedFiles.includes(file))
    throw Error("That file does not conflict");
  const show = async (commit: string) => {
    const result = await run(repo, ["show", `${commit}:${file}`]);
    return result.code === 0 ? result.out : null;
  };
  return {
    base: await show(projection.mergeBase),
    upstream: await show(projection.upstreamSha),
    local: await show(projection.branchSha),
  };
}

export interface SpeculativeRebase {
  clean: boolean;
  /** The rebased tip when clean. The real branch is not moved. */
  resultSha: string | null;
  conflictedFiles: string[];
}

/**
 * Tries a rebase in a throwaway worktree. The branch, its worktree and the
 * user's files are never touched; the result is only a commit id to adopt.
 */
export async function speculativeRebase(
  repo: string,
  branch: string,
  upstream: string,
  options: GitOptions = {},
): Promise<SpeculativeRebase> {
  assertRef(branch);
  assertRef(upstream);
  const sandbox = await mkdtemp(join(tmpdir(), "amun-rebase-"));
  const tree = join(sandbox, "tree");
  try {
    await git(repo, ["worktree", "add", "--detach", tree, branch]);
    const rebase = await run(tree, ["rebase", upstream], options);
    if (rebase.code === 0)
      return {
        clean: true,
        resultSha: await git(tree, ["rev-parse", "HEAD"]),
        conflictedFiles: [],
      };
    const conflictedFiles = (
      await git(tree, ["diff", "--name-only", "--diff-filter=U"])
    )
      .split("\n")
      .filter(Boolean);
    await run(tree, ["rebase", "--abort"]);
    return { clean: false, resultSha: null, conflictedFiles };
  } finally {
    await run(repo, ["worktree", "remove", "--force", tree]);
    await rm(sandbox, { recursive: true, force: true });
    await run(repo, ["worktree", "prune"]);
  }
}

/** Refuses direct changes to a protected branch. */
export function assertWritable(
  branch: string,
  protectedBranches: readonly string[],
): void {
  if (protectedBranches.includes(branch))
    throw Error(`${branch} is protected: change it through a pull request`);
}

/** Creates a branch at a commit without checking it out or moving anything. */
export async function forkBranch(
  repo: string,
  name: string,
  from: string,
): Promise<string> {
  assertRef(name);
  assertRef(from);
  if (
    (
      await run(repo, [
        "rev-parse",
        "--verify",
        "--quiet",
        "refs/heads/" + name,
      ])
    ).code === 0
  )
    throw Error("A branch with that name already exists");
  const sha = await git(repo, ["rev-parse", "--verify", from + "^{commit}"]);
  await git(repo, ["branch", "--no-track", name, sha]);
  return sha;
}

/**
 * Applies one commit onto another branch. It is tried in a throwaway
 * worktree first; the target moves only if the commit applies cleanly.
 */
export async function cherryPickTo(
  repo: string,
  commit: string,
  target: string,
  protectedBranches: readonly string[],
  options: GitOptions = {},
): Promise<{
  applied: boolean;
  resultSha: string | null;
  conflictedFiles: string[];
}> {
  assertRef(commit);
  assertRef(target);
  assertWritable(target, protectedBranches);
  const before = await git(repo, [
    "rev-parse",
    "--verify",
    "refs/heads/" + target,
  ]);
  const checkedOut = (await branchGraph(repo, target)).find(
    (node) => node.name === target,
  )?.worktree;
  if (checkedOut && (await git(checkedOut, ["status", "--porcelain"])) !== "")
    throw Error("The target branch has uncommitted changes in its worktree");
  const sandbox = await mkdtemp(join(tmpdir(), "amun-pick-"));
  const tree = join(sandbox, "tree");
  try {
    await git(repo, ["worktree", "add", "--detach", tree, before]);
    const pick = await run(tree, ["cherry-pick", commit], options);
    if (pick.code !== 0) {
      const conflictedFiles = (
        await git(tree, ["diff", "--name-only", "--diff-filter=U"])
      )
        .split("\n")
        .filter(Boolean);
      await run(tree, ["cherry-pick", "--abort"]);
      return { applied: false, resultSha: null, conflictedFiles };
    }
    const resultSha = await git(tree, ["rev-parse", "HEAD"]);
    if (checkedOut) await git(checkedOut, ["merge", "--ff-only", resultSha]);
    // The old value is required, so a branch that moved meanwhile is not overwritten.
    else
      await git(repo, [
        "update-ref",
        "refs/heads/" + target,
        resultSha,
        before,
      ]);
    return { applied: true, resultSha, conflictedFiles: [] };
  } finally {
    await run(repo, ["worktree", "remove", "--force", tree]);
    await rm(sandbox, { recursive: true, force: true });
    await run(repo, ["worktree", "prune"]);
  }
}

/** Keeps a commit reachable under a private ref so it can be restored. */
export async function pinCommit(
  repo: string,
  id: string,
  sha: string,
): Promise<void> {
  if (!/^[a-f0-9-]{8,64}$/.test(id)) throw Error("Invalid checkpoint id");
  await git(repo, ["update-ref", "refs/amun/checkpoints/" + id, sha]);
}

export async function branchTip(repo: string, branch: string): Promise<string> {
  assertRef(branch);
  return git(repo, ["rev-parse", "--verify", "refs/heads/" + branch]);
}

/**
 * Moves a branch back to an earlier commit. A branch checked out with
 * uncommitted changes is refused, so no unsaved work is lost.
 */
export async function restoreBranch(
  repo: string,
  branch: string,
  sha: string,
  protectedBranches: readonly string[],
): Promise<void> {
  assertRef(branch);
  assertWritable(branch, protectedBranches);
  const worktree = (await branchGraph(repo, branch)).find(
    (n) => n.name === branch,
  )?.worktree;
  if (worktree) {
    if ((await git(worktree, ["status", "--porcelain"])) !== "")
      throw Error(
        "Commit or discard changes in the worktree before rolling back",
      );
    await git(worktree, ["reset", "--hard", sha]);
  } else await git(repo, ["update-ref", "refs/heads/" + branch, sha]);
}
