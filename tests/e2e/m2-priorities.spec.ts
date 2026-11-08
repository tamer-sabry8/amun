import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("Priorities ranks completed RICE estimates and keeps unknown values incomplete", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-m2-rice-"));
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
    await expect(page.locator("#service-status")).toHaveText("Connected");
    await page
      .getByRole("combobox", { name: "Product", exact: true })
      .selectOption({ label: "New product…" });
    await page.getByLabel("Product name").pressSequentially("Amun");
    await page.getByRole("button", { name: "Create product" }).click();
    await page.getByRole("button", { name: "Priorities", exact: true }).click();
    for (const [objective, reach] of [
      ["Unknown", ""],
      ["Smaller", "40"],
      ["Larger", "120"],
    ] as const) {
      await page.getByRole("button", { name: "New priority" }).click();
      await page.getByLabel("Priority objective").fill(objective!);
      await page.getByLabel("Reach (people per quarter)").fill(reach!);
      await page
        .getByLabel("Impact (0.25 minimal to 3 massive)")
        .selectOption("2");
      await page.getByLabel("Confidence (%)").fill("75");
      await page.getByLabel("Effort (person-months)").fill("3");
      await page.getByRole("button", { name: "Save priority" }).click();
      await expect(
        page.getByRole("cell", { name: objective, exact: true }),
      ).toBeVisible();
    }
    const rows = page.getByRole("table").getByRole("row");
    await expect(rows.nth(1)).toContainText("Larger");
    await expect(rows.nth(1).getByRole("cell").nth(7)).toHaveText("60");
    await expect(rows.nth(2)).toContainText("Smaller");
    await expect(rows.nth(3)).toContainText("Incomplete");
  } finally {
    await app.close();
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
});
