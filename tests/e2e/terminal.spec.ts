import { test, expect, _electron as electron } from "@playwright/test";
test("service PTY is read-only until control, echoes and resizes with a minimal environment", async () => {
  const app = await electron.launch({
    args: process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"],
    ...(process.env.AMUN_PACKAGED_PATH
      ? { executablePath: process.env.AMUN_PACKAGED_PATH }
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
    await page
      .getByRole("button", { name: "Open terminal", exact: true })
      .click({ timeout: 3000 });
    await expect(page.locator("#terminal-status")).toHaveText("readonly");
    await page.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("echo FORBIDDEN");
    await page.keyboard.press("Enter");
    await expect(page.locator("#terminal-output")).not.toContainText(
      "FORBIDDEN",
    );
    await page
      .getByRole("button", { name: "Take control", exact: true })
      .click();
    await expect(page.locator("#terminal-status")).toHaveText("control");
    await page.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("printf 'PTY_%s\\n' OK; stty size");
    await page.keyboard.press("Enter");
    await expect(page.locator("#terminal-output")).toContainText("PTY_OK");
    const screen = await page.locator(".xterm-screen").boundingBox();
    expect(screen?.width).toBeGreaterThan(100);
    expect(screen?.height).toBeGreaterThan(100);
    await expect(page.locator(".xterm-rows")).toContainText("PTY_OK");
    await expect(page.locator("#terminal-output")).toContainText("24 80");
    await page.getByRole("button", { name: "Resize 100 × 30" }).click();
    await page.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("stty size");
    await page.keyboard.press("Enter");
    await expect(page.locator("#terminal-output")).toContainText("30 100");
    await page
      .getByRole("button", { name: "Close terminal", exact: true })
      .click();
    await expect(page.locator("#terminal-status")).toHaveText("closed");
  } finally {
    await app.close();
  }
});
