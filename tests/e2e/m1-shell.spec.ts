import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("M1 shell has fixed navigation, explicit overlay drawers and persisted accessible themes", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-m1-shell-"));
  const launch = () =>
    electron.launch({
      args: [
        ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
        "--user-data-dir=" + root,
      ],
      ...(process.env.AMUN_PACKAGED_PATH
        ? { executablePath: process.env.AMUN_PACKAGED_PATH }
        : {}),
      chromiumSandbox: true,
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(page.getByTestId("workspace")).toBeVisible();
    expect(await page.getByTestId("tool-tile").allTextContents()).toEqual([
      "Browser",
      "Terminal",
      "Requests0",
      "Agents",
      "Decisions",
      "Priorities",
    ]);
    await expect(page.getByTestId("drawer")).toHaveCount(0);
    const before = await page.getByTestId("workspace").boundingBox();
    await page.getByRole("button", { name: /^Activity drawer/ }).hover();
    await expect(page.getByTestId("drawer")).toBeVisible();
    expect(await page.getByTestId("workspace").boundingBox()).toEqual(before);
    await page.getByRole("button", { name: /^Activity drawer/ }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("drawer")).toHaveCount(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("tab", { name: "Appearance", exact: true }).click();
    await page.getByLabel("Theme").selectOption("navy-cyan");
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "navy-cyan",
    );
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "navy-cyan",
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("drawer intent and grace timers are exact, pinning is exclusive and Escape restores focus", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-drawer-timers-"));
  const app = await electron.launch({
    args: [
      ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
      "--user-data-dir=" + root,
    ],
    ...(process.env.AMUN_PACKAGED_PATH
      ? { executablePath: process.env.AMUN_PACKAGED_PATH }
      : {}),
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("status")).toHaveText("Connected");
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const activity = page.getByRole("button", {
      name: /^Activity drawer/,
    });
    await activity.dispatchEvent("pointerover", { pointerType: "mouse" });
    await page.clock.runFor(149);
    await expect(page.getByTestId("drawer")).toHaveCount(0);
    await page.clock.runFor(1);
    await expect(page.getByTestId("drawer")).toBeVisible();
    await activity.dispatchEvent("pointerout", { pointerType: "mouse" });
    await page.clock.runFor(249);
    await expect(page.getByTestId("drawer")).toBeVisible();
    await page.clock.runFor(1);
    await expect(page.getByTestId("drawer")).toHaveCount(0);
    await activity.click();
    await activity.dispatchEvent("pointerout", { pointerType: "mouse" });
    await page.clock.runFor(300);
    await expect(page.getByTestId("drawer")).toHaveAccessibleName("Activity");
    const downloads = page.getByRole("button", {
      name: "Downloads drawer",
      exact: true,
    });
    await downloads.dispatchEvent("pointerover", { pointerType: "mouse" });
    await page.clock.runFor(200);
    await expect(page.getByTestId("drawer")).toHaveAccessibleName("Activity");
    await downloads.click();
    await expect(page.getByTestId("drawer")).toHaveCount(1);
    await expect(page.getByTestId("drawer")).toHaveAccessibleName("Downloads");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("drawer")).toHaveCount(0);
    await expect(downloads).toBeFocused();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
