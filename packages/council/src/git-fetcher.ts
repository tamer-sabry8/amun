// Fetches upstream with the Mac's own git. Used for the weekly Council update
// once an update source is configured; never touches the user's checkouts.
import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Fetcher } from "./runtime.ts";

const run = promisify(execFile);
const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function gitFetcher(repo: string): Fetcher {
  if (!repoPattern.test(repo)) throw Error("Invalid update source");
  const url = `https://github.com/${repo}.git`;
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  return {
    async head() {
      const { stdout } = await run("git", ["ls-remote", url, "HEAD"], {
        env,
        timeout: 30_000,
      });
      const commit = stdout.trim().split(/\s+/)[0] ?? "";
      if (!/^[a-f0-9]{40}$/.test(commit))
        throw Error("Upstream did not answer");
      return commit;
    },
    async download(commit, destination) {
      await run("git", ["init", "--quiet", destination], {
        env,
        timeout: 30_000,
      });
      await run(
        "git",
        ["-C", destination, "fetch", "--quiet", "--depth", "1", url, commit],
        { env, timeout: 120_000 },
      );
      await run(
        "git",
        ["-C", destination, "checkout", "--quiet", "--detach", "FETCH_HEAD"],
        { env, timeout: 30_000 },
      );
      const { stdout } = await run(
        "git",
        ["-C", destination, "rev-parse", "HEAD"],
        {
          env,
        },
      );
      // The files must be exactly the commit that was asked for.
      if (stdout.trim() !== commit)
        throw Error("Downloaded a different version");
      await rm(join(destination, ".git"), { recursive: true, force: true });
    },
    async requiredNode(directory) {
      try {
        const manifest = JSON.parse(
          await readFile(join(directory, "package.json"), "utf8"),
        );
        return typeof manifest.engines?.node === "string"
          ? manifest.engines.node
          : null;
      } catch {
        return null;
      }
    },
  };
}
