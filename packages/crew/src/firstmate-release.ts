import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  lstat,
  link,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  catalog,
  release,
  type Release,
} from "../../contracts/src/firstmate-release.ts";
import { verifyDistributionArchive } from "./distribution.ts";
import {
  createFirstmateWorktrees,
  ownedWorktreeBranch,
} from "./firstmate-worktree.ts";
import { assertRuntimeContained } from "./runtime-links.ts";
import { patchFirstmatePermissions } from "./firstmate-policy-patch.ts";
import { readBoundedPrivateFile } from "./endpoint-receipt.ts";
export class FirstmateReleases {
  constructor(
    private selection: string,
    private archives: string,
    private current: Release,
    private previous: Release | null,
  ) {
    release.parse(current);
    if (previous && release.parse(previous).commit === current.commit)
      throw Error("Duplicate retained revision");
  }
  static async open(workspace: string, archives: string) {
    const data = catalog.parse(
      JSON.parse(await readFile(join(archives, "catalog.json"), "utf8")),
    );
    return new FirstmateReleases(
      join(workspace, "firstmate-selection"),
      archives,
      data.current,
      data.previous,
    );
  }
  async selected() {
    try {
      await lstat(this.selection);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return this.current;
      throw error;
    }
    const saved = await readBoundedPrivateFile(this.selection, 64);
    const pin = [this.current, this.previous].find((p) => p?.commit === saved);
    if (!pin) throw Error("Selected Firstmate revision unavailable");
    return pin;
  }
  private async verifiedBytes(pin: Release) {
    const bytes = await readFile(join(this.archives, pin.commit + ".tgz"));
    verifyDistributionArchive(bytes, pin.sha256);
    return bytes;
  }
  async rollback() {
    if (!this.previous) throw Error("No retained Firstmate revision");
    await this.selected();
    await this.verifiedBytes(this.previous);
    const temp = this.selection + "-" + randomUUID();
    try {
      await writeFile(temp, this.previous.commit, { mode: 0o600, flag: "wx" });
      await rename(temp, this.selection);
    } finally {
      await rm(temp, { force: true });
    }
    return this.previous;
  }
  async crewHome() {
    const workspace = dirname(this.selection);
    const binding = join(workspace, "firstmate-crew-home");
    const readHome = async () => {
      const name = await readBoundedPrivateFile(binding, 128);
      if (!/^firstmate-home-[A-Za-z0-9]{6}$/.test(name))
        throw Error("Invalid crew home");
      const owner = join(workspace, name),
        root = join(owner, "git"),
        home = join(root, "primary");
      const revision = await readBoundedPrivateFile(
        join(owner, "source-revision"),
        40,
      );
      if (!/^[a-f0-9]{40}$/.test(revision))
        throw Error("Invalid crew revision");
      for (const harness of ["codex", "claude"]) {
        if (
          (await ownedWorktreeBranch(home, join(root, harness + "-worker"))) !==
          "amun/" + harness + "-worker"
        )
          throw Error("Unexpected crew worktree branch");
      }
      return { home, revision };
    };
    try {
      await lstat(binding);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const prepared = await this.prepare(true);
      const owner = dirname(dirname(prepared.home));
      const staged = join(owner, "crew-binding");
      await writeFile(staged, basename(owner), {
        mode: 0o600,
        flag: "wx",
        flush: true,
      });
      try {
        await link(staged, binding);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        // Another caller published its newly prepared crew first. This candidate was never visible.
        await rm(owner, { recursive: true, force: true });
      }
    }
    return readHome();
  }
  async verifyHomes(revision: string, homes: readonly string[]) {
    const pin = [this.current, this.previous].find(
      (release) => release?.commit === revision,
    );
    if (!pin) throw Error("Crew release unavailable");
    const reference = await this.preparePin(pin, false);
    const git = async (home: string, args: string[]) =>
      (
        await promisify(execFile)(
          "/usr/bin/git",
          [
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=/dev/null",
            "-C",
            home,
            ...args,
          ],
          {
            env: {
              PATH: "/usr/bin:/bin",
              GIT_CONFIG_NOSYSTEM: "1",
              GIT_CONFIG_GLOBAL: "/dev/null",
            },
            timeout: 15000,
            maxBuffer: 65536,
          },
        )
      ).stdout.trim();
    try {
      const tree = await git(reference.home, ["rev-parse", "HEAD^{tree}"]);
      for (const home of homes) {
        if ((await git(home, ["rev-parse", "HEAD^{tree}"])) !== tree)
          throw Error("Crew source changed");
        await git(home, [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--quiet",
          tree,
          "--",
        ]);
        if (
          await git(home, [
            "ls-files",
            "--others",
            "--",
            "bin",
            "skills",
            ".pi",
            ".claude",
            ".codex",
            ".agents",
          ])
        )
          throw Error("Unreviewed crew resources");
      }
    } finally {
      await rm(dirname(dirname(reference.home)), {
        recursive: true,
        force: true,
      });
    }
  }
  async prepare(crew = false) {
    return this.preparePin(await this.selected(), crew);
  }
  private async preparePin(pin: Release, crew: boolean) {
    const bytes = await this.verifiedBytes(pin);
    const parent = dirname(this.selection);
    if ((await realpath(parent)) !== parent) throw Error("Unsafe workspace");
    const owner = await mkdtemp(join(parent, "firstmate-home-"));
    const source = await mkdtemp(join(owner, "source-"));
    try {
      const archive = join(source, "source.tgz"),
        tree = join(source, "distribution");
      await writeFile(archive, bytes, { mode: 0o600, flag: "wx" });
      await mkdir(tree, { mode: 0o700 });
      await promisify(execFile)(
        "/usr/bin/tar",
        ["-xzf", archive, "--strip-components=1", "-C", tree],
        { env: { PATH: "/usr/bin:/bin" }, timeout: 60000 },
      );
      await assertRuntimeContained(tree);
      const policy = join(tree, "bin/fm-config-inherit-lib.sh");
      await writeFile(
        policy,
        patchFirstmatePermissions(
          await readFile(policy, "utf8"),
          "e76b7896b018ee6e31e564f3660e5698b7a135dabbe28b730c62690dc3fc0f0a",
        ),
      );
      const worktrees = await createFirstmateWorktrees(
        tree,
        join(owner, "git"),
        crew ? ["primary", "codex-worker", "claude-worker"] : ["primary"],
      );
      await writeFile(join(owner, "source-revision"), pin.commit, {
        mode: 0o600,
        flag: "wx",
      });
      return { revision: pin.commit, home: worktrees.homes.primary! };
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  }
}
