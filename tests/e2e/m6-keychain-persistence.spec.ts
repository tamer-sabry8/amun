import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launchMacWorkspace } from "../support/mac-workspace.ts";
import { acceptanceDb } from "../support/ado-acceptance-drafts.ts";
import { workspaceIdentity } from "../../packages/data/src/identity.ts";

test("app-owned Keychain connection survives reads, rotation and full app restarts", async () => {
  test.skip(
    process.platform !== "darwin" || !process.env.AMUN_PACKAGED_PATH,
    "Packaged Mac Keychain acceptance.",
  );
  test.setTimeout(120000);
  const root = await mkdtemp(join(tmpdir(), "amun-keychain-owned-"));
  let app = await launchMacWorkspace(root);
  let removed = false;
  try {
    let identity = "";
    for (let pass = 0; pass < 3; pass++) {
      const page = await app.firstWindow();
      await expect(page.locator("#service-status")).toHaveText("Connected");
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const row = page
        .locator(".connection-row")
        .filter({ hasText: "https://example.invalid/keychain-acceptance" });
      if (pass === 0) {
        await page.getByLabel("Service", { exact: true }).selectOption("ado");
        await page
          .getByLabel("Collection or organisation URL")
          .fill("https://example.invalid/keychain-acceptance");
        await page
          .getByLabel("Personal access token")
          .fill("SYNTHETIC-KEYCHAIN-CANARY-ONE");
        await page
          .getByRole("button", { name: "Save connection", exact: true })
          .click();
      }
      await expect(row).toContainText("configured", { timeout: 15000 });
      const db = acceptanceDb(root);
      try {
        const current = workspaceIdentity(db);
        if (identity) expect(current).toBe(identity);
        identity = current;
      } finally {
        db.close();
      }
      for (let read = 0; read < 4; read++) {
        await page
          .getByRole("button", { name: "Overview", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Settings", exact: true })
          .click();
        await expect(row).toContainText("configured");
      }
      if (pass === 1) {
        await page.getByLabel("Service", { exact: true }).selectOption("ado");
        await page
          .getByLabel("Collection or organisation URL")
          .fill("https://example.invalid/keychain-acceptance");
        await page
          .getByLabel("Personal access token")
          .fill("SYNTHETIC-KEYCHAIN-CANARY-TWO");
        await page
          .getByRole("button", { name: "Save connection", exact: true })
          .click();
        await expect(row).toContainText("configured");
      }
      if (pass < 2) {
        await app.close();
        app = await launchMacWorkspace(root);
      }
    }
    const page = await app.firstWindow();
    await page
      .locator(".connection-row")
      .filter({ hasText: "https://example.invalid/keychain-acceptance" })
      .getByRole("button", { name: "Disconnect", exact: true })
      .click();
    await expect(
      page
        .locator(".connection-row")
        .filter({ hasText: "https://example.invalid/keychain-acceptance" }),
    ).toHaveCount(0);
    removed = true;
  } finally {
    await app.close();
    if (removed)
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
  }
});
