import { test, expect, _electron as electron } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("opening an active profile returns to its existing window", async () => {
  const profile = mkdtempSync(join(tmpdir(), "amun-profile-owner-"));
  const executablePath = process.env.AMUN_PACKAGED_PATH;
  const args = [
    ...(executablePath ? [] : ["apps/desktop"]),
    "--user-data-dir=" + profile,
  ];
  const owner = await electron.launch({
    args,
    ...(executablePath ? { executablePath } : {}),
  });
  try {
    const page = await owner.firstWindow();
    await expect(page.locator("#service-status")).toHaveText("Connected");
    await page
      .getByRole("button", { name: "Open conversations", exact: true })
      .click();
    await owner.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.minimize(),
    );
    const binary = await owner.evaluate(() => process.execPath);
    const second = spawn(binary, args, { stdio: "ignore" });
    try {
      await expect.poll(() => second.exitCode, { timeout: 5000 }).toBe(0);
      expect(
        await owner.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().map((w) => w.isMinimized()),
        ),
      ).toEqual([false]);
      await expect(
        page.getByRole("heading", { name: "Conversations", exact: true }),
      ).toBeVisible();
    } finally {
      if (second.exitCode === null && second.signalCode === null) {
        const done = once(second, "exit");
        second.kill();
        await done;
      }
    }
  } finally {
    await owner.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
