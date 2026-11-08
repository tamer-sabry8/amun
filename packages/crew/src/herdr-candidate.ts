import { lstat, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { userInfo } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readBoundedPrivateFile } from "./endpoint-receipt.ts";
import {
  herdrCandidateReceipt,
  type CandidateReceipt,
} from "../../contracts/src/herdr-candidate.ts";

export function matchesCandidatePane(
  receipt: CandidateReceipt,
  text: string,
  pane: Record<string, unknown>,
) {
  const expected: Record<string, string> = {
    harness: receipt.harness,
    kind: "secondmate",
    backend: "herdr",
    spawn_gen: receipt.generation,
    worktree: receipt.worktree,
    herdr_session: receipt.session,
    herdr_pane_id: receipt.pane,
    herdr_tab_id: receipt.tab,
    herdr_workspace_id: receipt.workspace,
    window: receipt.session + ":" + receipt.pane,
  };
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const i = line.indexOf("="),
      key = line.slice(0, i);
    if (i < 1 || !Object.hasOwn(expected, key)) continue;
    if (seen.has(key) || line.slice(i + 1) !== expected[key]) return false;
    seen.add(key);
  }
  return (
    seen.size === Object.keys(expected).length &&
    pane.pane_id === receipt.pane &&
    pane.tab_id === receipt.tab &&
    pane.workspace_id === receipt.workspace &&
    pane.terminal_id === receipt.terminal &&
    pane.cwd === receipt.worktree
  );
}
/** Explicit candidate-lab proof only. Read-only CLI operations; a missing endpoint stays unknown. */
export async function observeCandidate(receipts: string, task: string) {
  const unknown = { endpoint: "unknown", worker: "unknown" } as const;
  try {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(task)) return unknown;
    const privateDir = async (dir: string) => {
      const stat = await lstat(dir);
      return (
        stat.isDirectory() &&
        stat.uid === process.getuid?.() &&
        (stat.mode & 0o077) === 0 &&
        (await realpath(dir)) === dir
      );
    };
    if (!(await privateDir(receipts))) return unknown;
    const r = herdrCandidateReceipt.parse(
      JSON.parse(
        await readBoundedPrivateFile(join(receipts, task + ".json"), 8192),
      ),
    );
    if (
      task !== r.task ||
      dirname(r.scope) !== "/private/tmp" ||
      dirname(r.worktree) !== r.scope ||
      dirname(r.home) !== r.scope ||
      r.home === r.worktree ||
      !(await privateDir(r.scope)) ||
      !(await privateDir(r.worktree)) ||
      !(await privateDir(join(r.home, "state")))
    )
      return unknown;
    const home = userInfo().homedir;
    const env = {
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      PATH: "/usr/bin:/bin",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_OPTIONAL_LOCKS: "0",
    };
    const run = async (binary: string, args: string[]) =>
      (
        await promisify(execFile)(binary, args, {
          env,
          timeout: 4000,
          maxBuffer: 65536,
        })
      ).stdout.trim();
    for (const dir of [r.home, r.worktree]) {
      if (
        (await realpath(dir)) !== dir ||
        !(await lstat(join(dir, ".git"))).isFile() ||
        (await run("/usr/bin/git", [
          "-C",
          dir,
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        ])) !== join(r.scope, "repository.git")
      )
        return unknown;
    }
    const socket = join(
      home,
      ".config/herdr/sessions",
      r.session,
      "herdr.sock",
    );
    const sameSocket = async () => {
      const st = await lstat(socket);
      return (
        st.isSocket() &&
        st.uid === process.getuid?.() &&
        st.dev === r.socketDevice &&
        st.ino === r.socketInode &&
        (await realpath(socket)) === socket
      );
    };
    if (!(await sameSocket())) return unknown;
    const meta = await readBoundedPrivateFile(
      join(r.home, "state", task + ".meta"),
      65536,
    );
    const live = JSON.parse(
      await run(join(home, ".local/bin/herdr"), [
        "pane",
        "get",
        r.pane,
        "--session",
        r.session,
      ]),
    );
    if (
      !matchesCandidatePane(r, meta, live.result.pane) ||
      !(await sameSocket())
    )
      return unknown;
    return { endpoint: "verified", worker: "unknown" } as const;
  } catch {
    return unknown;
  }
}
