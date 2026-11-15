// Amun's own copy of a repository, where a crewmate changes code. It lives in
// Amun's store, never in a personal checkout. Everything here goes through
// one injectable `run`, so tests never touch git or the network.
import { execFile } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { hashDiff } from "../../../packages/data/src/code-change.ts";

export type Run = (
  args: string[],
  options: { cwd?: string; env?: Record<string, string> },
) => Promise<string>;

/** A problem the owner can be told about in plain words. */
export class CodeChangeError extends Error {}

export type ChangedFile = {
  path: string;
  status: "added" | "changed" | "removed" | "renamed";
  additions: number;
  deletions: number;
};
export type Collected =
  | { ok: true; empty: true }
  | {
      ok: true;
      empty: false;
      files: ChangedFile[];
      diff: string;
      diffHash: string;
      baseSha: string;
    }
  | { ok: false; reason: string };

export const maxDiffBytes = 512 * 1024;
const safeName = /^[A-Za-z0-9_.-]+$/;
const safeRef = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/;
const uuid = /^[a-f0-9-]{36}$/;
const askpassBody =
  '#!/bin/sh\ncase "$1" in\n  Username*) printf %s x-access-token ;;\n  *) printf %s "$AMUN_GIT_TOKEN" ;;\nesac\n';

/** Runs git with no personal configuration, hooks or prompts. */
export const gitRunner =
  (binary = "git"): Run =>
  (args, { cwd, env }) =>
    new Promise((resolveRun, reject) =>
      execFile(
        binary,
        args,
        {
          cwd,
          timeout: 120_000,
          maxBuffer: 16 * 1024 * 1024,
          env: {
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            LANG: "C",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_TERMINAL_PROMPT: "0",
            ...env,
          },
        },
        (error, stdout, stderr) =>
          error
            ? reject(Error(String(stderr || error.message)))
            : resolveRun(stdout),
      ),
    );

export const branchName = (title: string, id: string) => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .replace(/-+$/g, "");
  return `amun/${slug || "change"}-${id.replace(/-/g, "").slice(0, 6)}`;
};

export class CodeWorkspace {
  constructor(
    private readonly store: string,
    private readonly run: Run = gitRunner(),
  ) {}

  private folder(id: string) {
    if (!uuid.test(id)) throw Error("Invalid job");
    return join(this.store, "code", id);
  }
  private async askpass() {
    const dir = join(this.store, "code");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, "askpass.sh");
    await writeFile(file, askpassBody, { mode: 0o700 });
    return file;
  }
  /** The token travels in the environment of one command only. */
  private async git(
    args: string[],
    options: { cwd?: string; token?: string } = {},
  ) {
    const env: Record<string, string> = options.token
      ? {
          GIT_ASKPASS: await this.askpass(),
          AMUN_GIT_TOKEN: options.token,
        }
      : {};
    try {
      return await this.run(args, {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        env,
      });
    } catch (error) {
      let text = error instanceof Error ? error.message : "git failed";
      if (options.token) text = text.split(options.token).join("***");
      throw new CodeChangeError(text.slice(0, 300));
    }
  }
  private inside(path: string, root: string) {
    const rel = relative(root, path);
    return !!rel && !rel.startsWith("..") && !isAbsolute(rel);
  }

  /** A shallow https copy and a new worktree on a new branch from the default branch. */
  async prepare(input: {
    id: string;
    origin: string;
    owner: string;
    repo: string;
    base: string;
    branch: string;
    token: string;
  }) {
    const url = new URL(input.origin);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !safeName.test(input.owner) ||
      !safeName.test(input.repo) ||
      !safeRef.test(input.base) ||
      !/^amun\/[a-z0-9][a-z0-9-]{0,60}$/.test(input.branch) ||
      input.branch === input.base
    )
      throw new CodeChangeError("This repository can't be copied by Amun.");
    const dir = this.folder(input.id);
    const repoDir = join(dir, "repo");
    const worktree = join(dir, "worktree");
    const noHooks = join(dir, "no-hooks");
    await mkdir(noHooks, { recursive: true, mode: 0o700 });
    const remote = `${url.origin}/${input.owner}/${input.repo}.git`;
    const locked = [
      "-c",
      "core.hooksPath=" + noHooks,
      "-c",
      "core.symlinks=false",
      "-c",
      "credential.helper=",
      "-c",
      "protocol.allow=never",
      "-c",
      "protocol.https.allow=always",
    ];
    await this.git(
      [
        ...locked,
        "clone",
        "--depth",
        "1",
        "--single-branch",
        "--no-tags",
        "--no-recurse-submodules",
        "--branch",
        input.base,
        remote,
        repoDir,
      ],
      { token: input.token },
    );
    for (const [key, value] of [
      ["core.hooksPath", noHooks],
      ["core.symlinks", "false"],
      ["credential.helper", ""],
      ["protocol.allow", "never"],
      ["protocol.https.allow", "always"],
      ["push.default", "nothing"],
    ] as const)
      await this.git(["config", key, value], { cwd: repoDir });
    await this.git(
      ["worktree", "add", "-b", input.branch, worktree, input.base],
      { cwd: repoDir },
    );
    await this.verify(input.id, input.branch);
    return { dir, worktree, remote };
  }

  /** The folder must be a real worktree of Amun's own copy, on the expected branch. */
  async verify(id: string, branch: string) {
    const dir = this.folder(id);
    const worktree = join(dir, "worktree");
    const top = (
      await this.git(["rev-parse", "--show-toplevel"], { cwd: worktree })
    ).trim();
    const common = (
      await this.git(
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        {
          cwd: worktree,
        },
      )
    ).trim();
    const [realTop, realWork, realCommon, realRepo, realStore] =
      await Promise.all([
        realpath(top),
        realpath(worktree),
        realpath(common),
        realpath(join(dir, "repo", ".git")),
        realpath(this.store),
      ]);
    const current = (
      await this.git(["branch", "--show-current"], { cwd: worktree })
    ).trim();
    if (
      realTop !== realWork ||
      realCommon !== realRepo ||
      !this.inside(realWork, realStore) ||
      current !== branch
    )
      throw new CodeChangeError(
        "The working copy is not Amun's own. Nothing was sent.",
      );
    return worktree;
  }

  /** What changed in the worktree, in the exact form the owner reviews. */
  async collect(id: string, branch: string): Promise<Collected> {
    const worktree = await this.verify(id, branch);
    await this.git(["add", "-A"], { cwd: worktree });
    const raw = (
      await this.git(
        ["diff", "--cached", "--raw", "-z", "-M", "--no-ext-diff"],
        {
          cwd: worktree,
        },
      )
    ).split("\0");
    const counts = (
      await this.git(["diff", "--cached", "--numstat", "-z", "-M"], {
        cwd: worktree,
      })
    ).split("\0");
    const files: ChangedFile[] = [];
    const root = resolve(worktree);
    for (let i = 0; i < raw.length - 1;) {
      const meta = raw[i++]!;
      if (!meta.startsWith(":")) continue;
      const [, newMode, , , letter] = meta.split(" ");
      const status = letter![0]!;
      const first = raw[i++]!;
      const path = status === "R" || status === "C" ? raw[i++]! : first;
      if (
        newMode === "120000" ||
        newMode === "160000" ||
        isAbsolute(path) ||
        path.split("/").some((part) => part === ".." || part === ".git") ||
        path === ".gitmodules" ||
        !this.inside(resolve(root, path), root)
      )
        return {
          ok: false,
          reason:
            "This change adds a link, a submodule or a file outside the project, so Amun won't open a pull request for it.",
        };
      files.push({
        path,
        status:
          status === "A"
            ? "added"
            : status === "D"
              ? "removed"
              : status === "R"
                ? "renamed"
                : "changed",
        additions: 0,
        deletions: 0,
      });
    }
    for (let i = 0; i < counts.length - 1;) {
      const entry = counts[i++]!;
      const [add, del, ...rest] = entry.split("\t");
      let path = rest.join("\t");
      if (!path) {
        i++;
        path = counts[i++]!;
      }
      if (add === "-" || del === "-")
        return {
          ok: false,
          reason:
            "This change includes a file Amun can't show line by line, so it won't open a pull request for it.",
        };
      const file = files.find((f) => f.path === path);
      if (file) {
        file.additions = Number(add);
        file.deletions = Number(del);
      }
    }
    if (!files.length) return { ok: true, empty: true };
    const diff = await this.git(
      [
        "diff",
        "--cached",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--full-index",
        "-M",
      ],
      { cwd: worktree },
    );
    if (Buffer.byteLength(diff) > maxDiffBytes)
      return {
        ok: false,
        reason:
          "This change is too large to read in full here, so Amun won't open a pull request for it.",
      };
    const baseSha = (
      await this.git(["rev-parse", "HEAD"], { cwd: worktree })
    ).trim();
    return {
      ok: true,
      empty: false,
      files,
      diff,
      diffHash: hashDiff(diff),
      baseSha,
    };
  }

  /** Commits what is staged, with hooks and signing off. Returns the commit. */
  async commit(
    id: string,
    branch: string,
    message: string,
    author: { name: string; email: string },
  ) {
    const worktree = await this.verify(id, branch);
    const hooks = join(this.folder(id), "no-hooks");
    await this.git(
      [
        "-c",
        "core.hooksPath=" + hooks,
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=" + author.name,
        "-c",
        "user.email=" + author.email,
        "commit",
        "--no-verify",
        "--no-gpg-sign",
        "-m",
        message,
      ],
      { cwd: worktree },
    );
    return (await this.git(["rev-parse", "HEAD"], { cwd: worktree })).trim();
  }
  async head(id: string, branch: string) {
    const worktree = await this.verify(id, branch);
    return (await this.git(["rev-parse", "HEAD"], { cwd: worktree })).trim();
  }

  /** The commit the branch points to on GitHub, if the branch is there. */
  async remoteHead(id: string, branch: string, token: string) {
    const worktree = await this.verify(id, branch);
    const out = await this.git(
      ["ls-remote", "--heads", "origin", "refs/heads/" + branch],
      { cwd: worktree, token },
    );
    const sha = out.trim().split(/\s+/)[0];
    return sha && /^[a-f0-9]{40}$/.test(sha) ? sha : undefined;
  }

  /** Pushes the new branch only: never a force, never the base branch. */
  async push(id: string, branch: string, base: string, token: string) {
    if (!/^amun\/[a-z0-9][a-z0-9-]{0,60}$/.test(branch) || branch === base)
      throw new CodeChangeError("Amun only pushes its own new branches.");
    const worktree = await this.verify(id, branch);
    await this.git(
      [
        "-c",
        "credential.helper=",
        "-c",
        "core.hooksPath=" + join(this.folder(id), "no-hooks"),
        "push",
        "--no-verify",
        "origin",
        `refs/heads/${branch}:refs/heads/${branch}`,
      ],
      { cwd: worktree, token },
    );
  }
}
