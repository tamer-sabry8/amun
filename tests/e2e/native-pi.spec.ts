import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("native Pi commands create an owned SDK session and update its real name", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-native-ui-"));
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
    await page.getByRole("tab", { name: "Models", exact: true }).click();
    await page
      .getByRole("button", { name: "Open Pi commands", exact: true })
      .click();
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("name");
    await page
      .getByLabel("Command argument", { exact: true })
      .fill("Native session acceptance");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Native session acceptance",
      { timeout: 20000 },
    );
    await page.getByLabel("Command argument", { exact: true }).fill("");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Native session acceptance",
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
