import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, realpath, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
const exec = promisify(execFile);
async function git(cwd: string, ...args: string[]) {
  const result = await exec(
    "/usr/bin/git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "protocol.allow=never",
      "-c",
      "protocol.file.allow=always",
      ...args,
    ],
    {
      cwd,
      env: {
        PATH: "/usr/bin:/bin",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
      },
      timeout: 120000,
      maxBuffer: 262144,
    },
  );
  return result.stdout.trim();
}
function paths(root: string, id: string, prefix: "test" | "delivery") {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      id,
    )
  )
    throw Error("Invalid delivery id.");
  const dir = join(resolve(root), id);
  return {
    dir,
    worktree: join(dir, "checkout"),
    store: join(dir, "repository.git"),
    branch: prefix + "/story-" + id,
  };
}
async function repository(source: string, remote: string) {
  const url = new URL(remote);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("Select a mapped HTTPS repository.");
  const path = await realpath(source);
  if (
    (await realpath(await git(path, "rev-parse", "--show-toplevel"))) !==
      path ||
    (await git(path, "remote", "get-url", "origin")) !== remote
  )
    throw Error("Local checkout does not match the mapped repository.");
  return path;
}
export async function previewDeliveryTree(
  root: string,
  source: string,
  remote: string,
  id: string,
  prefix: "test" | "delivery" = "delivery",
) {
  const path = await repository(source, remote);
  const { worktree, branch } = paths(root, id, prefix);
  const head = await git(path, "rev-parse", "--verify", "HEAD^{commit}");
  if (!/^[a-f0-9]{40}$/.test(head)) throw Error("Unsupported Git commit.");
  return { id, source: path, remote, head, branch, worktree };
}
export async function materializeDeliveryTree(
  root: string,
  scope: Awaited<ReturnType<typeof previewDeliveryTree>>,
) {
  const { dir, worktree, store, branch } = paths(
    root,
    scope.id,
    scope.branch.startsWith("test/") ? "test" : "delivery",
  );
  if (
    scope.worktree !== worktree ||
    scope.branch !== branch ||
    !/^[a-f0-9]{40}$/.test(scope.head)
  )
    throw Error("Delivery scope changed.");
  const source = await repository(scope.source, scope.remote);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (
    (await realpath(dir)) !== dir ||
    (await lstat(dir)).uid !== process.getuid?.()
  )
    throw Error("Delivery directory changed.");
  const exists = async (path: string) => {
    try {
      if ((await realpath(path)) !== path)
        throw Error("Delivery path changed.");
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw e;
    }
  };
  if (!(await exists(store))) {
    if ((await git(source, "rev-parse", "HEAD")) !== scope.head)
      throw Error("Source commit changed. Review the new scope.");
    await git(dir, "clone", "--bare", "--no-local", "--", source, store);
    await git(store, "remote", "set-url", "origin", scope.remote);
  }
  if ((await git(store, "remote", "get-url", "origin")) !== scope.remote)
    throw Error("Delivery repository changed.");
  if (!(await exists(worktree)))
    await git(store, "worktree", "add", "-b", branch, worktree, scope.head);
  if (
    (await realpath(
      await git(
        worktree,
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ),
    )) !== store ||
    (await git(worktree, "branch", "--show-current")) !== branch
  )
    throw Error("Delivery worktree changed.");
  await git(worktree, "merge-base", "--is-ancestor", scope.head, "HEAD");
  return worktree;
}

export async function deliveryHead(
  root: string,
  scope: Awaited<ReturnType<typeof previewDeliveryTree>>,
) {
  const { worktree, store, branch } = paths(
    root,
    scope.id,
    scope.branch.startsWith("test/") ? "test" : "delivery",
  );
  if (
    (await realpath(worktree)) !== worktree ||
    scope.worktree !== worktree ||
    (await git(
      worktree,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    )) !== store ||
    (await git(worktree, "branch", "--show-current")) !== branch
  )
    throw Error("Delivery checkout changed.");
  return git(worktree, "rev-parse", "HEAD");
}
