import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createTmuxScope,
  tmuxEnvironment,
} from "../packages/crew/src/tmux-scope.ts";
import { saveEndpointReceipt } from "../packages/crew/src/endpoint-receipt.ts";
import { observeOwnedTmux } from "../packages/crew/src/observe-owned-tmux.ts";
if (process.argv[2] === "--observe") {
  console.log(
    JSON.stringify(
      await observeOwnedTmux(process.argv[3]!, "proof-1", process.argv[4]!),
    ),
  );
} else {
  const exec = promisify(execFile);
  const binary = (
    await exec("/bin/sh", ["-c", "command -v tmux"])
  ).stdout.trim();
  assert(binary.startsWith("/"));
  const scope = await createTmuxScope();
  const home = join(scope, "home"),
    state = join(home, "state"),
    work = join(scope, "work"),
    receipts = join(scope, "receipts");
  for (const directory of [home, state, work, receipts])
    await mkdir(directory, { mode: 0o700 });
  const env = tmuxEnvironment(scope, { HOME: home, PATH: "/usr/bin:/bin" });
  const run = async (args: string[]) =>
    (
      await exec(binary, args, { env, timeout: 10000, maxBuffer: 65536 })
    ).stdout.trim();
  try {
    const target = await run([
      "-f",
      "/dev/null",
      "new-session",
      "-d",
      "-s",
      "firstmate",
      "-n",
      "fm-proof-1",
      "-P",
      "-F",
      "#{pane_id}",
      "-c",
      work,
      "sleep 120",
    ]);
    await run(["set-window-option", "-t", target, "automatic-rename", "off"]);
    await run(["rename-window", "-t", target, "fm-proof-1"]);
    const ownerToken = randomBytes(16).toString("hex");
    await run(["set-option", "-g", "@amun-owner", ownerToken]);
    const [paneId, windowId, server, pid, socketValue] = (
      await run([
        "display-message",
        "-p",
        "-t",
        target,
        "#{pane_id}|#{window_id}|#{pid}|#{pane_pid}|#{socket_path}",
      ])
    ).split("|");
    assert(paneId && windowId && server && pid && socketValue);
    const socket = await realpath(socketValue);
    await writeFile(
      join(state, "proof-1.meta"),
      `window=firstmate:fm-proof-1\nendpoint_task_id=proof-1\nworktree=${work}\nspawn_gen=proof.1\nharness=codex\n`,
      { mode: 0o600, flag: "wx" },
    );
    await saveEndpointReceipt(receipts, {
      version: 1,
      backend: "tmux",
      home,
      scope,
      socket,
      identity: {
        taskId: "proof-1",
        window: "firstmate:fm-proof-1",
        worktree: work,
        spawnGeneration: "proof.1",
        paneId,
        windowId,
        serverPid: Number(server),
        panePid: Number(pid),
        ownerToken,
      },
    });
    const before = await run([
      "list-panes",
      "-a",
      "-F",
      "#{pane_id}:#{pane_pid}",
    ]);
    for (let trial = 0; trial < 10; trial++) {
      const result = await exec(
        process.execPath,
        [
          resolve("scripts/tmux-observe-proof.ts"),
          "--observe",
          receipts,
          binary,
        ],
        { env: { PATH: "/usr/bin:/bin" }, timeout: 10000, maxBuffer: 65536 },
      );
      assert.deepEqual(JSON.parse(result.stdout), {
        endpoint: "verified",
        worker: "unknown",
      });
      assert.equal(
        await run(["list-panes", "-a", "-F", "#{pane_id}:#{pane_pid}"]),
        before,
      );
    }
    await run([
      "set-option",
      "-g",
      "@amun-owner",
      randomBytes(16).toString("hex"),
    ]);
    assert.deepEqual(await observeOwnedTmux(receipts, "proof-1", binary), {
      endpoint: "unknown",
      worker: "unknown",
    });
    console.log(
      JSON.stringify({
        syntheticPane: true,
        realWorkerDispatches: 0,
        freshObserverProcesses: 10,
        unchangedPaneIdentity: true,
        ownerMismatchUnknown: true,
        workerStatus: "unknown",
        realWorkerRestartGatePassed: false,
      }),
    );
  } finally {
    await run(["kill-server"]).catch(() => {});
    await rm(scope, { recursive: true, force: true });
  }
}
