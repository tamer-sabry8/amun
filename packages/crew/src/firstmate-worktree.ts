import {
  cp,
  mkdir,
  readFile,
  lstat,
  realpath,
  rm,
  chmod,
} from "node:fs/promises";
import {
  resolve,
  basename,
  dirname,
  join,
  relative,
  isAbsolute,
} from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertRuntimeContained, repairRuntimeLinks } from "./runtime-links.ts";
/** Materialize a checksum-staged snapshot into an Amun-owned Git store and genuine worktrees.
 * The new commit identifies the bundled snapshot (including Amun patches), not the upstream commit.
 * Existing destinations are never adopted or overwritten; failed partial roots remain for inspection.
 */
export async function createFirstmateWorktrees(
  source: string,
  destination: string,
  names: string[],
): Promise<{ repository: string; homes: Record<string, string> }> {
  if (
    !names.length ||
    names.length > 16 ||
    new Set(names).size !== names.length ||
    names.some((name) => !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name))
  )
    throw new Error("Invalid worktree names");
  const snapshot = await realpath(source),
    root = resolve(destination),
    parent = dirname(root);
  if (
    (await realpath(parent)) !== parent ||
    root === snapshot ||
    (!relative(snapshot, root).startsWith("..") &&
      !isAbsolute(relative(snapshot, root)))
  )
    throw new Error("Unsafe worktree root");
  await assertRuntimeContained(snapshot);
  // A source Git directory would import unrelated history/configuration. Accept only the staged snapshot.
  try {
    await lstat(join(snapshot, ".git"));
    throw new Error("Expected a staged snapshot");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(root, { mode: 0o700 });
  const seed = join(root, "snapshot"),
    repository = join(root, "repository.git");
  await cp(snapshot, seed, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await repairRuntimeLinks(snapshot, seed);
  const git = async (args: string[]) =>
    (
      await promisify(execFile)(
        "/usr/bin/git",
        [
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        {
          cwd: root,
          env: {
            HOME: root,
            PATH: "/usr/bin:/bin",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
          },
          timeout: 60000,
          maxBuffer: 65536,
        },
      )
    ).stdout;
  await git(["-C", seed, "init", "-b", "main"]);
  await git(["-C", seed, "add", "--force", "."]);
  await git([
    "-C",
    seed,
    "-c",
    "user.name=Amun runtime",
    "-c",
    "user.email=runtime@amun.invalid",
    "commit",
    "--no-verify",
    "-m",
    "Pinned Amun Firstmate runtime snapshot",
  ]);
  await git(["clone", "--bare", "--no-hardlinks", seed, repository]);
  await git(["-C", repository, "remote", "remove", "origin"]);
  const homes: Record<string, string> = {};
  for (const [index, name] of names.entries()) {
    const home = join(root, name);
    await git([
      "-C",
      repository,
      "worktree",
      "add",
      ...(index === 0 ? [] : ["-b", "amun/" + name]),
      home,
      "main",
    ]);
    if (
      !(await lstat(join(home, ".git"))).isFile() ||
      (await git(["-C", home, "rev-parse", "--show-toplevel"])).trim() !== home
    )
      throw new Error("Worktree identity mismatch");
    await chmod(home, 0o700);
    homes[name] = home;
  }
  await rm(seed, { recursive: true, force: true });
  return { repository, homes };
}

/** Bind both directions of a linked checkout to the private repository prepared for this primary. */
export async function ownedWorktreeBranch(primary: string, worker: string) {
  const root = dirname(primary);
  const repository = join(root, "repository.git");
  if (
    basename(primary) !== "primary" ||
    worker === primary ||
    dirname(worker) !== root
  )
    throw Error("Worktree is outside this crew");
  const owner = await lstat(root);
  if (
    owner.uid !== process.getuid?.() ||
    (owner.mode & 0o077) !== 0 ||
    (await realpath(repository)) !== repository
  )
    throw Error("Unsafe crew repository");
  async function verifyMarker(file: string, expected: string) {
    const info = await lstat(file);
    if (
      !info.isFile() ||
      info.size > 8192 ||
      (await realpath(file)) !== file ||
      (await readFile(file, "utf8")).trimEnd() !== expected
    )
      throw Error("Worktree registration mismatch");
  }
  for (const home of [primary, worker]) {
    const admin = join(repository, "worktrees", basename(home));
    await verifyMarker(join(home, ".git"), "gitdir: " + admin);
    await verifyMarker(join(admin, "gitdir"), join(home, ".git"));
    await verifyMarker(join(admin, "commondir"), "../..");
  }
  const result = await promisify(execFile)(
    "/usr/bin/git",
    ["-C", worker, "symbolic-ref", "--short", "HEAD"],
    {
      env: {
        PATH: "/usr/bin:/bin",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_OPTIONAL_LOCKS: "0",
      },
      timeout: 3000,
      maxBuffer: 8192,
    },
  );
  return result.stdout.trim();
}
