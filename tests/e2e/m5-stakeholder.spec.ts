import { launchMacWorkspace } from "../support/mac-workspace.ts";
import { test, expect } from "@playwright/test";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { openWorkspace } from "../../packages/data/src/workspace.ts";
test("stakeholder draft cites evidence, marks unknowns and exports a Mac PDF only after exact review", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-m5-update-"));
  const db = openWorkspace(
    join(root, "workspace"),
    createRequire(resolve("packages/data/package.json"))("better-sqlite3"),
  );
  db.exec(
    `INSERT INTO products(id,name,created_at) VALUES('p','Atlas','now'); INSERT INTO workspace_settings VALUES('ui_preferences','{"productId":"p"}'); INSERT INTO work_items(id,product_id,type,title,status) VALUES('atlas-1','p','story','Review rollout','draft')`,
  );
  db.close();
  const app = await launchMacWorkspace(root);
  try {
    const page = await app.firstWindow();
    await page.getByText("Stakeholder update", { exact: true }).click();
    await page
      .getByRole("button", { name: "Draft from source records" })
      .click();
    const field = page.getByLabel("Update content");
    await expect(field).toHaveValue(/Review rollout.*\[work item: atlas-1\]/);
    await expect(field).toHaveValue(/Unknown/);
    const review = page.getByRole("button", {
      name: "Review exact content and destination",
    });
    await review.click();
    const approve = page.getByRole("button", {
      name: "Approve exact PDF export",
    });
    await expect(approve).toBeVisible();
    await field.fill((await field.inputValue()) + "\nNext review is pending.");
    await expect(approve).toHaveCount(0);
    const dir = join(root, "workspace", "exports");
    await expect(readdir(dir)).rejects.toThrow();
    await review.click();
    await approve.click();
    await expect(page.getByText(/PDF saved to/)).toBeVisible();
    const pdfs = await readdir(dir);
    expect(pdfs).toHaveLength(1);
    expect(
      (await readFile(join(dir, pdfs[0]!))).subarray(0, 5).toString(),
    ).toBe("%PDF-");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
