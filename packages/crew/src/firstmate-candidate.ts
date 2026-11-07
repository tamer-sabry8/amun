import { execFile } from "node:child_process";
import { promisify } from "node:util";

async function upstreamMain() {
  const result = await promisify(execFile)(
    "/usr/bin/git",
    [
      "-c",
      "http.followRedirects=false",
      "ls-remote",
      "--exit-code",
      "--refs",
      "https://github.com/kunchenguid/firstmate.git",
      "refs/heads/main",
    ],
    {
      cwd: "/",
      env: {
        PATH: "/usr/bin:/bin",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
      },
      timeout: 15000,
      maxBuffer: 4096,
    },
  );
  return result.stdout;
}
export async function checkFirstmateCandidate(
  argument: string,
  lookup = upstreamMain,
) {
  if (argument.trim()) throw Error("The candidate check accepts no arguments.");
  const hash = /^([a-f0-9]{40})\trefs\/heads\/main\n?$/.exec(
    await lookup(),
  )?.[1];
  if (!hash) throw Error("Could not verify the upstream main revision.");
  return `Upstream Firstmate main: ${hash}. This is a candidate for testing. Promotion requires a disposable worktree, overlay verification, Pi replay, approval-gate and Herdr recovery tests, followed by your approval.`;
}
