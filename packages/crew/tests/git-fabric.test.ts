import { it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertWritable,
  branchGraph,
  branchTip,
  cherryPickTo,
  conflictRadar,
  conflictVersions,
  forkBranch,
  pinCommit,
  restoreBranch,
  speculativeRebase,
} from "../src/git-fabric.ts";
import { findOnPath, probeTool } from "../src/tool-probe.ts";
import { knownTools } from "../../domain/src/tool-detection.ts";

let root = "";
let repo = "";
const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    "/usr/bin/git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=t@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    {
      cwd,
      encoding: "utf8",
      env: {
        PATH: "/usr/bin:/bin",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    },
  ).trim();
const commit = async (
  cwd: string,
  file: string,
  text: string,
  message: string,
) => {
  await writeFile(join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "amun-fabric-"));
  repo = join(root, "repo");
  await mkdir(repo);
  git(repo, "init", "-q", "-b", "main");
  await commit(repo, "app.txt", "line one\nline two\nline three\n", "Initial");
  await commit(repo, "readme.txt", "Readme\n", "Add readme");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("draws branch lineage, stacked branches, ahead and behind counts and worktrees", async () => {
  git(repo, "branch", "feature");
  const tree = join(root, "feature-tree");
  git(repo, "worktree", "add", "-q", tree, "feature");
  await commit(tree, "feature.txt", "feature\n", "Feature work");
  git(repo, "branch", "stacked", "feature");
  git(repo, "checkout", "-q", "stacked");
  await commit(repo, "stacked.txt", "stacked\n", "Stacked work");
  git(repo, "checkout", "-q", "main");
  await commit(repo, "main.txt", "main\n", "Main moves on");
  const graph = await branchGraph(repo, "main");
  expect(
    graph.map((n) => [n.name, n.parent, n.ahead, n.behind, n.isBase]),
  ).toEqual([
    ["main", null, 0, 0, true],
    ["feature", "main", 1, 1, false],
    ["stacked", "feature", 2, 1, false],
  ]);
  expect(graph[1]?.worktree).toContain("feature-tree");
  expect(graph[2]?.worktree).toBeNull();
  await expect(branchGraph(repo, "nope")).rejects.toThrow(/Unknown base/);
  await expect(branchGraph(repo, "--upload-pack=x")).rejects.toThrow(
    /Invalid branch/,
  );
});

it("warns of a conflict before any merge and supplies the three versions to reconcile", async () => {
  git(repo, "checkout", "-q", "-b", "feature");
  await commit(
    repo,
    "app.txt",
    "line one\nLOCAL two\nline three\n",
    "Local change",
  );
  await commit(repo, "ui.txt", "ui\n", "Local ui");
  git(repo, "checkout", "-q", "main");
  await commit(
    repo,
    "app.txt",
    "line one\nUPSTREAM two\nline three\n",
    "Upstream change",
  );
  await commit(repo, "api.txt", "api\n", "Upstream api");
  const before =
    git(repo, "status", "--porcelain") + git(repo, "rev-parse", "feature");
  const radar = await conflictRadar(repo, "feature", "main");
  expect(radar).toMatchObject({
    conflicts: true,
    conflictedFiles: ["app.txt"],
    upstreamChanged: ["api.txt", "app.txt"],
    localChanged: ["app.txt", "ui.txt"],
    bothChanged: ["app.txt"],
  });
  expect(
    git(repo, "status", "--porcelain") + git(repo, "rev-parse", "feature"),
  ).toBe(before);
  expect(await conflictVersions(repo, radar, "app.txt")).toEqual({
    base: "line one\nline two\nline three",
    upstream: "line one\nUPSTREAM two\nline three",
    local: "line one\nLOCAL two\nline three",
  });
  await expect(conflictVersions(repo, radar, "ui.txt")).rejects.toThrow(
    /does not conflict/,
  );
  const sandboxed = await speculativeRebase(repo, "feature", "main");
  expect(sandboxed).toEqual({
    clean: false,
    resultSha: null,
    conflictedFiles: ["app.txt"],
  });
  expect(git(repo, "worktree", "list").split("\n")).toHaveLength(1);
  expect(git(repo, "rev-parse", "feature")).toBe(radar.branchSha);
});

it("reports no conflict when both sides change different files and rebases in a sandbox without moving the branch", async () => {
  git(repo, "checkout", "-q", "-b", "feature");
  const local = await commit(repo, "ui.txt", "ui\n", "Local ui");
  git(repo, "checkout", "-q", "main");
  const upstream = await commit(repo, "api.txt", "api\n", "Upstream api");
  expect(await conflictRadar(repo, "feature", "main")).toMatchObject({
    conflicts: false,
    conflictedFiles: [],
    bothChanged: [],
  });
  const rebased = await speculativeRebase(repo, "feature", "main");
  expect(rebased.clean).toBe(true);
  expect(git(repo, "rev-parse", "feature")).toBe(local);
  expect(git(repo, "rev-parse", rebased.resultSha! + "^")).toBe(upstream);
  expect(
    git(repo, "show", "--stat", "--format=", rebased.resultSha!),
  ).toContain("ui.txt");
  expect(git(repo, "worktree", "list").split("\n")).toHaveLength(1);
});

it("forks without checking out, cherry-picks only when clean, and protects the default branch", async () => {
  const start = git(repo, "rev-parse", "HEAD");
  expect(await forkBranch(repo, "alternative", "main")).toBe(start);
  await expect(forkBranch(repo, "alternative", "main")).rejects.toThrow(
    /already exists/,
  );
  await expect(forkBranch(repo, "bad name", "main")).rejects.toThrow(
    /Invalid branch/,
  );
  expect(git(repo, "branch", "--show-current")).toBe("main");
  git(repo, "checkout", "-q", "-b", "source");
  const good = await commit(repo, "extra.txt", "extra\n", "Extra file");
  const clash = await commit(repo, "app.txt", "rewritten\n", "Rewrite app");
  git(repo, "checkout", "-q", "main");
  git(repo, "checkout", "-q", "-b", "other");
  await commit(repo, "app.txt", "different\n", "Other rewrite");
  git(repo, "checkout", "-q", "main");
  await expect(cherryPickTo(repo, good, "main", ["main"])).rejects.toThrow(
    /main is protected/,
  );
  const applied = await cherryPickTo(repo, good, "alternative", ["main"]);
  expect(applied.applied).toBe(true);
  expect(git(repo, "rev-parse", "alternative")).toBe(applied.resultSha);
  expect(git(repo, "show", "alternative:extra.txt")).toBe("extra");
  const before = git(repo, "rev-parse", "other");
  expect(await cherryPickTo(repo, clash, "other", ["main"])).toEqual({
    applied: false,
    resultSha: null,
    conflictedFiles: ["app.txt"],
  });
  expect(git(repo, "rev-parse", "other")).toBe(before);
  expect(() => assertWritable("feature", ["main"])).not.toThrow();
});

it("rolls a branch back to a pinned commit and refuses when unsaved work would be lost", async () => {
  git(repo, "checkout", "-q", "-b", "feature");
  const before = git(repo, "rev-parse", "HEAD");
  await pinCommit(repo, "0a1b2c3d-0000", before);
  await commit(repo, "bad.txt", "bad\n", "Bad squash");
  expect(await branchTip(repo, "feature")).not.toBe(before);
  await writeFile(join(repo, "unsaved.txt"), "work in progress\n");
  await expect(
    restoreBranch(repo, "feature", before, ["main"]),
  ).rejects.toThrow(/Commit or discard/);
  expect(await readFile(join(repo, "unsaved.txt"), "utf8")).toBe(
    "work in progress\n",
  );
  await rm(join(repo, "unsaved.txt"));
  await restoreBranch(repo, "feature", before, ["main"]);
  expect(await branchTip(repo, "feature")).toBe(before);
  expect(git(repo, "rev-parse", "refs/amun/checkpoints/0a1b2c3d-0000")).toBe(
    before,
  );
  await expect(restoreBranch(repo, "main", before, ["main"])).rejects.toThrow(
    /protected/,
  );
  await expect(pinCommit(repo, "../x", before)).rejects.toThrow(
    /Invalid checkpoint/,
  );
  git(repo, "checkout", "-q", "main");
  await restoreBranch(repo, "feature", git(repo, "rev-parse", "main"), [
    "main",
  ]);
  expect(await branchTip(repo, "feature")).toBe(git(repo, "rev-parse", "main"));
});

it("probes a tool by its fixed version command only and reports missing or unrunnable tools", async () => {
  const bin = join(root, "bin");
  await mkdir(bin);
  const marker = join(root, "ran-with-args");
  await writeFile(
    join(bin, "codex"),
    `#!/bin/sh\necho "$@" > "${marker}"\necho "codex-cli 0.163.0"\n`,
  );
  await chmod(join(bin, "codex"), 0o755);
  await writeFile(join(bin, "claude"), "not executable");
  const tool = (id: string) => knownTools.find((t) => t.id === id)!;
  expect(await findOnPath("codex", bin)).toContain("/bin/codex");
  expect(await findOnPath("codex", "relative/dir")).toBeNull();
  await expect(findOnPath("../codex", bin)).rejects.toThrow(/Invalid command/);
  const found = await probeTool(tool("codex"), {
    pathList: bin + ":/usr/bin:/bin",
  });
  expect(found).toMatchObject({
    found: true,
    versionText: "codex-cli 0.163.0\n",
  });
  expect((await readFile(marker, "utf8")).trim()).toBe("--version");
  expect(await probeTool(tool("claude_code"), { pathList: bin })).toEqual({
    found: false,
  });
  expect(await probeTool(tool("opencode"), { pathList: bin })).toEqual({
    found: false,
  });
  await writeFile(join(bin, "tmux"), "#!/bin/sh\nexit 3\n");
  await chmod(join(bin, "tmux"), 0o755);
  expect(
    await probeTool(tool("tmux"), { pathList: bin + ":/bin" }),
  ).toMatchObject({ found: true, denied: false, error: "Could not run" });
  expect(await probeTool(tool("git"), { pathList: "/usr/bin" })).toMatchObject({
    found: true,
  });
});
