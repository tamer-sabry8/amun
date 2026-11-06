import { test, expect, _electron as electron } from "@playwright/test";
test("Pi extension dialogs cross the service boundary with explicit answers", async () => {
  const app = await electron.launch({
    args: process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"],
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
    args: process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"],
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
  } finally {
    await app.close();
  }
});
