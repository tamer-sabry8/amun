import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { _electron as electron, expect } from "@playwright/test";
const setup = JSON.parse(await readFile(process.argv[2]!, "utf8")) as {
  scope: string;
};
const socket = join(setup.scope, "tmux-" + process.getuid!(), "default");
const run = async (args: string[]) =>
  (
    await promisify(execFile)(
      "/opt/homebrew/bin/tmux",
      ["-N", "-S", socket, ...args],
      { timeout: 10000, maxBuffer: 65536 },
    )
  ).stdout.trim();
const panes = await run(["list-panes", "-a", "-F", "#{pane_id}|#{pane_pid}"]);
const clients = await run(["list-clients", "-F", "#{client_pid}"]);
if (clients) throw Error("Acceptance server already has attached clients");
const packaged = process.argv.includes("--packaged");
const app = await electron.launch({
  args: [
    ...(packaged ? [] : ["apps/desktop"]),
    "--user-data-dir=" + join(setup.scope, "app-data"),
  ],
  ...(packaged
    ? {
        executablePath: resolve(
          `apps/desktop/out/Amun-darwin-${process.arch}/Amun.app/Contents/MacOS/Amun`,
        ),
      }
    : {}),
  env: {
    HOME: process.env.HOME!,
    PATH: "/usr/bin:/bin",
    TMPDIR: process.env.TMPDIR!,
  },
  chromiumSandbox: true,
});
try {
  const page = await app.firstWindow();
  await expect(page.getByRole("status")).toHaveText("Connected");
  await page.getByLabel("Firstmate task ID").fill("proof-codex");
  await page.getByRole("button", { name: "Attach terminal read-only" }).click();
  await expect(page.locator("#terminal-status")).toHaveText("readonly");
  await expect(page.locator("#terminal-output")).toContainText("AMUN_CODEX_OK");
  await expect
    .poll(() => run(["list-clients", "-F", "#{client_readonly}"]))
    .toBe("1");
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("AMUN_READONLY_CANARY");
  if (
    (
      await run(["capture-pane", "-p", "-t", "firstmate:fm-proof-codex"])
    ).includes("AMUN_READONLY_CANARY")
  )
    throw Error("Read-only input reached worker");
  await page.getByRole("button", { name: "Take control", exact: true }).click();
  await expect(page.locator("#terminal-status")).toHaveText("control");
  await expect
    .poll(() => run(["list-clients", "-F", "#{client_readonly}"]))
    .toBe("0");
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("AMUN_CONTROL_CANARY");
  await expect
    .poll(() => run(["capture-pane", "-p", "-t", "firstmate:fm-proof-codex"]))
    .toContain("AMUN_CONTROL_CANARY");
  // Remove the draft without pressing Enter: no model request is submitted.
  await page.keyboard.press("Control+u");
  await page.getByRole("button", { name: "Resize 100 × 30" }).click();
  await expect
    .poll(() => run(["list-clients", "-F", "#{client_width}x#{client_height}"]))
    .toBe("100x30");
  await page.getByRole("button", { name: "Read only", exact: true }).click();
  await expect(page.locator("#terminal-status")).toHaveText("readonly");
  await expect
    .poll(() => run(["list-clients", "-F", "#{client_readonly}"]))
    .toBe("1");
  await page
    .getByRole("button", { name: "Close terminal", exact: true })
    .click();
  await expect(page.locator("#terminal-status")).toHaveText("closed");
  await expect
    .poll(() => run(["list-clients", "-F", "#{client_pid}"]))
    .toBe("");
  if (
    (await run(["list-panes", "-a", "-F", "#{pane_id}|#{pane_pid}"])) !== panes
  )
    throw Error("Worker endpoints changed");
  await page.getByRole("button", { name: "Attach terminal read-only" }).click();
  await expect(page.locator("#terminal-status")).toHaveText("readonly");
  const owner = await run(["show-options", "-gqv", "@amun-owner"]);
  await run(["set-option", "-g", "@amun-owner", "0".repeat(32)]);
  try {
    await page
      .getByRole("button", { name: "Take control", exact: true })
      .click();
    await expect(page.locator("#terminal-status")).toHaveText("unavailable");
    await expect
      .poll(() => run(["list-clients", "-F", "#{client_pid}"]))
      .toBe("");
  } finally {
    await run(["set-option", "-g", "@amun-owner", owner]);
  }
  console.log(
    JSON.stringify({
      packaged,
      actualWorkerAttached: true,
      nativeReadOnlyDefault: true,
      readOnlyInputBlocked: true,
      explicitControlVerified: true,
      resizeVerified: true,
      releaseReadOnly: true,
      clientClosedWorkersPreserved: true,
      modelRequestsSubmitted: 0,
      ownershipLossRefusesControl: true,
    }),
  );
} finally {
  await app.close();
}
