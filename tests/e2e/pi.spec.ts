import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, _electron as electron } from "@playwright/test";
test("Pi extension dialogs cross the service boundary with explicit answers", async () => {
  const app = await electron.launch({
    args: [
      ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
      "--amun-proof",
    ],
    ...(process.env.AMUN_PACKAGED_PATH
      ? { executablePath: process.env.AMUN_PACKAGED_PATH }
      : {}),
    chromiumSandbox: true,
  });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Open Pi protocol proof", exact: true })
      .click();
    await expect(page.locator("#pi-status")).toHaveText("ready");
    await page.getByLabel("Pi prompt").fill("/amun-dialog-proof");
    await page.getByRole("button", { name: "Send to Pi", exact: true }).click();
    await expect(page.locator("#pi-dialog")).toContainText(
      "Select proof option",
    );
    await page.getByRole("button", { name: "Option one", exact: true }).click();
    await expect(page.locator("#pi-dialog")).toContainText(
      "Confirm proof selection",
    );
    await page.getByRole("button", { name: "No", exact: true }).click();
    await expect(page.locator("#pi-dialog")).toBeEmpty();
    await page.getByRole("button", { name: "Close Pi", exact: true }).click();
    await expect(page.locator("#pi-status")).toHaveText("closed");
  } finally {
    await app.close();
  }
});

test("service loss clears Pi dialogs and terminal control instead of replaying them", async () => {
  const app = await electron.launch({
    args: [
      ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
      "--amun-proof",
    ],
    ...(process.env.AMUN_PACKAGED_PATH
      ? { executablePath: process.env.AMUN_PACKAGED_PATH }
      : {}),
    chromiumSandbox: true,
  });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Open terminal", exact: true })
      .click();
    await expect(page.locator("#terminal-status")).toHaveText("readonly");
    await page
      .getByRole("button", { name: "Take control", exact: true })
      .click();
    await expect(page.locator("#terminal-status")).toHaveText("control");
    await page
      .getByRole("button", { name: "Open Pi protocol proof", exact: true })
      .click();
    await expect(page.locator("#pi-status")).toHaveText("ready");
    await page.getByRole("button", { name: "Send to Pi", exact: true }).click();
    await expect(page.locator("#pi-dialog")).toContainText(
      "Select proof option",
    );
    const servicePid = await app.evaluate(
      ({ app }) =>
        app.getAppMetrics().find((p) => p.name === "Amun Service")?.pid,
    );
    if (!servicePid) throw new Error("Missing service");
    const childPids = (
      await promisify(execFile)("/usr/bin/pgrep", ["-P", String(servicePid)])
    ).stdout
      .trim()
      .split("\n");
    let privateRoot: string | undefined;
    for (const pid of childPids) {
      const listing = (
        await promisify(execFile)("/usr/sbin/lsof", [
          "-a",
          "-p",
          pid,
          "-d",
          "cwd",
          "-Fn",
        ])
      ).stdout;
      const candidate = listing
        .split("\n")
        .find(
          (line) =>
            line.startsWith("n/") && /\/amun-pi-service-[^/]+$/.test(line),
        );
      if (candidate) privateRoot = candidate.slice(1);
    }
    if (!privateRoot) throw new Error("No isolated Pi runtime found");
    const canary = join(privateRoot, "config/acceptance-canary.json");
    await writeFile(canary, JSON.stringify({ testOnly: "not-a-credential" }), {
      mode: 0o600,
      flag: "wx",
    });
    await app.evaluate(({ app }) => {
      const service = app
        .getAppMetrics()
        .find((p) => p.name === "Amun Service");
      if (!service) throw new Error("Missing service");
      process.kill(service.pid, "SIGKILL");
    });
    await expect(page.locator("#pi-dialog")).toBeEmpty();
    await expect(page.locator("#terminal-status")).toHaveText("unavailable");
    await expect(page.locator("#pi-status")).toHaveText("unavailable");
    await expect(page.getByRole("status")).toHaveText("Connected");
    await expect
      .poll(
        async () => {
          try {
            await access(canary);
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 10000 },
      )
      .toBe(false);
  } finally {
    await app.close();
  }
});
