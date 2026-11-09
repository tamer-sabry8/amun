import { launchMacWorkspace } from "../support/mac-workspace.ts";
import { test, expect } from "@playwright/test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { openWorkspace } from "../../packages/data/src/workspace.ts";
test("Mac skill library discovers source, rejects it, installs a pinned revision and updates the Firstmate draft", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-m5-skills-"));
  const Database = createRequire(resolve("packages/data/package.json"))(
    "better-sqlite3",
  );
  const db = openWorkspace(join(root, "workspace"), Database);
  db.exec(
    `INSERT INTO products(id,name,created_at) VALUES('p','Atlas','now'); INSERT INTO workspace_settings VALUES('ui_preferences','{"productId":"p"}');`,
  );
  db.close();
  const dir = join(root, "catalog", "release-notes");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), "Cite the accepted stories.");
  const app = await launchMacWorkspace(root);
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Skills and extensions drawer" })
      .click();
    const lib = page.getByRole("region", { name: "Skill library" });
    await lib
      .getByLabel("Discover skills in a folder")
      .setInputFiles(join(root, "catalog"));
    await lib.getByRole("button", { name: /release-notes\/SKILL.md/ }).click();
    await expect(lib.getByLabel("Skill instructions")).toHaveValue(
      "Cite the accepted stories.",
    );
    await lib.getByRole("button", { name: "Preview skill revision" }).click();
    await lib.getByRole("button", { name: "Reject revision" }).click();
    await expect(
      lib.getByRole("button", { name: "Use in Firstmate draft" }),
    ).toHaveCount(0);
    for (const text of [
      "Cite the accepted stories.",
      "List the open decisions.",
    ]) {
      await lib.getByLabel("Skill instructions").fill(text);
      await lib.getByRole("button", { name: "Preview skill revision" }).click();
      await expect(
        lib.getByRole("article").filter({ hasText: text }).locator("code"),
      ).toHaveText(/^[a-f0-9]{64}$/);
      await lib.getByRole("button", { name: "Approve installation" }).click();
      await expect(
        lib.getByRole("button", { name: "Approve installation" }),
      ).toHaveCount(0);
      await lib.getByRole("button", { name: "Use in Firstmate draft" }).click();
      await expect(
        page.getByRole("textbox", { name: "Ask Firstmate" }),
      ).toHaveValue(text);
    }
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
