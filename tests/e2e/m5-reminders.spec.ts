import { launchMacWorkspace } from "../support/mac-workspace.ts";
import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { openWorkspace } from "../../packages/data/src/workspace.ts";
test("Mac resume surfaces an overdue reminder once and waits for the task review", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-m5-reminder-"));
  const Database = createRequire(resolve("packages/data/package.json"))(
    "better-sqlite3",
  );
  const db = openWorkspace(join(root, "workspace"), Database);
  db.exec(
    `INSERT INTO products(id,name,created_at) VALUES('p','Atlas','now'); INSERT INTO workspace_settings VALUES('ui_preferences','{"productId":"p"}');`,
  );
  db.close();
  const app = await launchMacWorkspace(root);
  try {
    const page = await app.firstWindow();
    await page.getByText("Tasks and reminders", { exact: true }).click();
    await page.getByLabel("Task title").fill("Release check");
    await page.getByLabel("Remind me at").fill("2020-01-01T10:00");
    await page.getByLabel("Requires review").check();
    await page.getByRole("button", { name: "Schedule reminder" }).click();
    await app.evaluate(({ powerMonitor }) => {
      powerMonitor.emit("resume");
      powerMonitor.emit("resume");
    });
    await expect(
      page
        .locator("li")
        .filter({ hasText: "Release check" })
        .filter({ hasText: "awaiting review" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Notifications drawer" }).click();
    await expect(
      page.getByText("Missed reminder · Release check", { exact: true }),
    ).toHaveCount(1);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Approve task completion" }).click();
    await expect(
      page
        .locator("li")
        .filter({ hasText: "Release check" })
        .filter({ hasText: "completed" }),
    ).toBeVisible();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
