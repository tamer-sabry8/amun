import { readFile, mkdir, lstat, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { _electron as electron, expect } from "@playwright/test";
import {
  saveEndpointReceipt,
  loadEndpointReceipt,
} from "../packages/crew/src/endpoint-receipt.ts";
import { parseFirstmateRecord } from "../packages/crew/src/tmux-observer.ts";
const descriptor = process.argv[2];
if (!descriptor)
  throw Error(
    "Pass the private descriptor for already dispatched acceptance workers",
  );
const setup = JSON.parse(await readFile(descriptor, "utf8")) as {
  scope: string;
  primary: string;
};
const stat = await lstat(setup.scope);
if (
  stat.uid !== process.getuid?.() ||
  (stat.mode & 0o077) !== 0 ||
  (await realpath(setup.scope)) !== setup.scope
)
  throw Error("Unsafe acceptance scope");
const socket = join(setup.scope, "tmux-" + process.getuid!(), "default");
const run = async (args: string[]) =>
  (
    await promisify(execFile)(
      "/opt/homebrew/bin/tmux",
      ["-S", socket, ...args],
      { timeout: 10000, maxBuffer: 65536 },
    )
  ).stdout.trim();
const existingToken = await run(["show-options", "-gqv", "@amun-owner"]);
const token = existingToken || randomBytes(16).toString("hex");
if (!existingToken) await run(["set-option", "-g", "@amun-owner", token]);
const userData = join(setup.scope, "app-data");
const packaged = process.argv.includes("--packaged");
const app = await electron.launch({
  args: [
    ...(packaged ? [] : ["apps/desktop"]),
    "--amun-proof",
    "--user-data-dir=" + userData,
  ],
  ...(packaged
    ? {
        executablePath: resolve(
          `apps/desktop/out/Amun-darwin-${process.arch}/Amun.app/Contents/MacOS/Amun`,
        ),
      }
    : {}),
  chromiumSandbox: true,
});
try {
  if ((await app.evaluate(({ app }) => app.getPath("userData"))) !== userData)
    throw Error("Proof app userData isolation failed");
  const receipts = join(userData, "crew", "receipts");
  await mkdir(receipts, { recursive: true, mode: 0o700 });
  for (const taskId of ["proof-codex", "proof-claude"]) {
    const record = parseFirstmateRecord(
      await readFile(join(setup.primary, "state", taskId + ".meta"), "utf8"),
    );
    const [paneId, windowId, serverPid, panePid] = (
      await run([
        "display-message",
        "-p",
        "-t",
        record.window,
        "#{pane_id}|#{window_id}|#{pid}|#{pane_pid}",
      ])
    ).split("|");
    const receipt = {
      version: 1,
      backend: "tmux",
      home: setup.primary,
      scope: setup.scope,
      socket,
      identity: {
        taskId,
        window: record.window,
        worktree: record.worktree,
        spawnGeneration: record.spawnGeneration,
        paneId: paneId!,
        windowId: windowId!,
        serverPid: Number(serverPid),
        panePid: Number(panePid),
        ownerToken: token,
      },
    } as const;
    if (existingToken) {
      const saved = await loadEndpointReceipt(receipts, taskId);
      if (JSON.stringify(saved) !== JSON.stringify(receipt))
        throw Error(
          "Existing acceptance receipt differs; refuse ownership adoption",
        );
    } else await saveEndpointReceipt(receipts, receipt);
  }
  const baseline = await run([
    "list-panes",
    "-a",
    "-F",
    "#{pane_id}|#{pane_pid}|#{window_id}",
  ]);
  const workerProcesses = async () => {
    const roots = new Set(
      baseline.split("\n").map((line) => Number(line.split("|")[1])),
    );
    const output = (
      await promisify(execFile)(
        "/bin/ps",
        ["-axo", "pid=,ppid=,lstart=,comm="],
        { timeout: 10000, maxBuffer: 2097152 },
      )
    ).stdout;
    const rows = output
      .split("\n")
      .map((line) =>
        line
          .trim()
          .match(/^(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/),
      )
      .filter((row) => row !== null);
    for (let pass = 0; pass < 16; pass++)
      for (const row of rows)
        if (roots.has(Number(row[2]))) roots.add(Number(row[1]));
    const workers = rows
      .filter(
        (row) =>
          roots.has(Number(row[1])) && /(^|\/)(codex|claude)$/.test(row[4]!),
      )
      .map((row) => `${row[1]}|${row[3]}|${row[4]}`)
      .sort();
    if (
      !workers.some((row) => row.endsWith("codex")) ||
      !workers.some((row) => row.endsWith("claude"))
    )
      throw Error("Actual worker processes unavailable");
    return workers.join("\n");
  };
  const originalWorkers = await workerProcesses();
  const page = await app.firstWindow();
  await expect(page.getByRole("status")).toHaveText("Connected");
  const observe = async (id: string, expected: string) => {
    await page.getByLabel("Firstmate task ID").fill(id);
    await page.getByRole("button", { name: "Observe worker endpoint" }).click();
    await expect(page.locator("#crew-observation")).toHaveText(
      `${id}: endpoint ${expected}; worker unknown`,
      { timeout: 10000 },
    );
    if (expected === "verified") {
      await expect(page.locator("#crew-run")).toContainText("amun/");
      await expect(page.locator("#crew-run")).toContainText(
        "model unknown | unknown",
      );
    } else await expect(page.locator("#crew-run")).toHaveText("unknown");
  };
  // The existing observation-only adapter now also projects a validated Run.
  for (let trial = 1; trial <= 10; trial++) {
    for (const id of ["proof-codex", "proof-claude"])
      await observe(id, "verified");
    const pid = await app.evaluate(
      ({ app }) =>
        app.getAppMetrics().find((p) => p.name === "Amun Service")?.pid,
    );
    if (!pid) throw Error("Service missing");
    process.kill(pid, "SIGKILL");
    await expect
      .poll(
        () =>
          app.evaluate(
            ({ app }) =>
              app.getAppMetrics().find((p) => p.name === "Amun Service")?.pid,
          ),
        { timeout: 15000 },
      )
      .not.toBe(pid);
    await expect(page.getByRole("status")).toHaveText("Connected", {
      timeout: 15000,
    });
    await expect(page.locator("#crew-observation")).toHaveText("unknown");
    for (const id of ["proof-codex", "proof-claude"])
      await observe(id, "verified");
    if (
      (await run([
        "list-panes",
        "-a",
        "-F",
        "#{pane_id}|#{pane_pid}|#{window_id}",
      ])) !== baseline
    )
      throw Error("Worker endpoint inventory changed");
    if ((await workerProcesses()) !== originalWorkers)
      throw Error("Worker process identity changed");
    console.log(
      JSON.stringify({
        trial,
        packaged,
        realServiceRestart: true,
        sameWorkerEndpoints: true,
        sameWorkerProcesses: true,
        duplicateWorkers: 0,
        workerStatus: "unknown",
      }),
    );
  }
  await run(["set-option", "-g", "@amun-owner", "0".repeat(32)]);
  try {
    await observe("proof-codex", "unknown");
  } finally {
    await run(["set-option", "-g", "@amun-owner", token]);
  }
  console.log(
    JSON.stringify({ identityMismatchUnknown: true, observationPathSpawns: 0 }),
  );
} finally {
  await app.close();
}
