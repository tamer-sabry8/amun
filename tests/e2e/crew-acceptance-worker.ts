import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, join } from "node:path";
import { realpath } from "node:fs/promises";
import { loadEndpointReceipt } from "../../packages/crew/src/endpoint-receipt.ts";
import { observeOwnedTmux } from "../../packages/crew/src/observe-owned-tmux.ts";
import { ownedWorktreeBranch } from "../../packages/crew/src/firstmate-worktree.ts";

const exec = promisify(execFile);
export async function verifyDisposableWorker(
  root: string,
  harness: "codex" | "claude",
) {
  const id = "amun-" + harness,
    receipts = join(root, "crew/receipts"),
    binary = "/opt/homebrew/bin/tmux";
  const receipt = await loadEndpointReceipt(receipts, id);
  const worker = receipt.identity.worktree;
  if (
    !basename(root).startsWith("amun-dispatch-e2e-") ||
    (await realpath(root)) !== root ||
    !receipt.home.startsWith(root + "/workspace/firstmate-home-") ||
    (await ownedWorktreeBranch(receipt.home, worker)) !==
      "amun/" + harness + "-worker"
  )
    throw Error("Expected disposable verified worker home");
  const pane = receipt.identity.paneId;
  const tmux = async (args: string[]) =>
    (
      await exec(binary, ["-N", "-S", receipt.socket, ...args], {
        env: { PATH: "/usr/bin:/bin" },
        timeout: 3000,
        maxBuffer: 131072,
      })
    ).stdout;
  const check = async () => {
    if ((await observeOwnedTmux(receipts, id, binary)).endpoint !== "verified")
      throw Error("Worker endpoint identity changed");
    const git = (args: string[]) =>
      exec(
        "/usr/bin/git",
        ["-c", "core.fsmonitor=false", "-C", worker, ...args],
        {
          env: {
            PATH: "/usr/bin:/bin",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
          },
          timeout: 8000,
          maxBuffer: 65536,
        },
      );
    const resources = ["bin", ".pi", ".claude", ".codex", ".agents", "skills"];
    await git([
      "diff",
      "--quiet",
      "--no-ext-diff",
      "--no-textconv",
      "HEAD",
      "--",
      ...resources,
    ]);
    if ((await git(["ls-files", "--others", "--", ...resources])).stdout.trim())
      throw Error("Unreviewed hook source in disposable home");
  };
  let folderAccepted = false,
    hooksAccepted = false,
    submitted = false;
  let state = "starting";
  for (let attempt = 0; attempt < 155; attempt++) {
    const paneText = await tmux(["capture-pane", "-p", "-t", pane]);
    const screen = paneText
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[‐‑‒–—]/g, "-")
      .replace(/[*_]/g, "")
      .replace(/\s+/g, " ");
    if (submitted && /seven hundred(?: and)? thirty[- ]four/.test(screen))
      return;
    if (
      /not logged in|please run \/login|sign in to (chatgpt|claude)/.test(
        screen,
      )
    )
      throw Error(
        harness + " requires subscription sign-in in its Amun profile",
      );
    if (
      !hooksAccepted &&
      harness === "codex" &&
      screen.includes("hooks need review") &&
      screen.includes("5 hooks") &&
      /2[.)] trust all and continue/.test(screen)
    ) {
      await check();
      await tmux(["send-keys", "-t", pane, "Down", "Enter"]);
      hooksAccepted = true;
      state = "hook review";
    } else if (
      !folderAccepted &&
      /trust (?:this|the) (?:folder|files|directory|workspace|project)|do you trust/.test(
        screen,
      ) &&
      /yes, (?:i trust|trust|continue)|[›❯] 1[.] trust and continue/.test(
        screen,
      )
    ) {
      await check();
      await tmux(["send-keys", "-t", pane, "Enter"]);
      folderAccepted = true;
      state = "folder trust";
    } else if (
      !submitted &&
      !/hooks need review|yes, i trust|trust and continue/.test(screen) &&
      (/for shortcuts|for help|how can i help|gpt-[0-9].* · /.test(screen) ||
        (harness === "claude" &&
          screen.includes("auto mode on") &&
          /^\s*❯\s*$/m.test(paneText)))
    ) {
      await check();
      await tmux([
        "send-keys",
        "-t",
        pane,
        "-l",
        "Acceptance only. Reply with the sum of 481 and 253 written in English words. Do not use tools.",
      ]);
      await new Promise((done) => setTimeout(done, 350));
      await tmux(["send-keys", "-t", pane, "Enter"]);
      submitted = true;
      state = "awaiting the reply";
    }
    await new Promise((done) => setTimeout(done, 600));
  }
  throw Error(harness + " did not return a verified answer (" + state + ")");
}
