import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test.use({ actionTimeout: 5000 });
test("Notion offers hosted browser sign-in without token entry or publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-notion-ui-"));
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
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByLabel("Service", { exact: true })
      .selectOption("notion", { timeout: 5000 });
    await expect(
      page.getByRole("button", { name: "Connect Notion in browser" }),
    ).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByLabel("Sign-in browser")).toHaveValue("edge");
    await page.getByLabel("Sign-in browser").selectOption("dia");
    await expect(page.getByLabel("Sign-in browser")).toHaveValue("dia");
    await page.getByRole("button", { name: "Test Notion connection" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "no content was published",
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
