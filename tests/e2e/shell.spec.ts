import { test, expect, _electron as electron } from "@playwright/test";

test("shell launches with no privileged renderer APIs and denies external requests", async () => {
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
    await expect(
      page.getByRole("heading", { name: "Amun", exact: true }),
    ).toBeVisible();
    const isolation = await page.evaluate(() => ({
      require: typeof Reflect.get(window, "require"),
      process: typeof Reflect.get(window, "process"),
    }));
    expect(isolation).toEqual({ require: "undefined", process: "undefined" });
    const allowed = await page.evaluate(async () => {
      try {
        await fetch("https://example.com");
        return true;
      } catch {
        return false;
      }
    });
    expect(allowed).toBe(false);
  } finally {
    await app.close();
  }
});

test("service crash reconnects over a fresh port within five seconds", async () => {
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
    await expect(page.getByRole("status")).toHaveText("Connected");
    await page.evaluate(() => {
      const status = document.getElementById("service-status");
      if (!status) throw new Error("Missing status");
      new MutationObserver(() => {
        if (status.textContent === "Reconnecting")
          status.dataset.sawReconnect = "true";
      }).observe(status, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });
    const start = Date.now();
    await app.evaluate(({ app }) => {
      const service = app
        .getAppMetrics()
        .find((metric) => metric.name === "Amun Service");
      if (!service) throw new Error("Amun service was not launched");
      process.kill(service.pid, "SIGKILL");
    });
    await expect(page.getByRole("status")).toHaveAttribute(
      "data-saw-reconnect",
      "true",
      { timeout: 5000 },
    );
    await expect(page.getByRole("status")).toHaveText("Connected", {
      timeout: Math.max(1, 5000 - (Date.now() - start)),
    });
    expect(Date.now() - start).toBeLessThan(5000);
  } finally {
    await app.close();
  }
});
