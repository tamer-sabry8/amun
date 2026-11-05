import { test, expect, _electron as electron } from "@playwright/test";

test("shell launches with no privileged renderer APIs and denies external requests", async () => {
  const app = await electron.launch({
    args: ["apps/desktop"],
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
