import { launchMacWorkspace } from "../support/mac-workspace.ts";
import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { openWorkspace } from "../../packages/data/src/workspace.ts";
import { MemorySync } from "../../packages/data/src/memory-sync.ts";
test("Mac memory review keeps an offline edit, shows a conflict side by side, and retains unlink after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-m5-sync-"));
  const Database = createRequire(resolve("packages/data/package.json"))(
    "better-sqlite3",
  );
  const launch = () => launchMacWorkspace(root);
  let app;
  try {
    const db = openWorkspace(join(root, "workspace"), Database);
    try {
      db.exec(`INSERT INTO products(id,name,created_at) VALUES('p','Atlas','now');
 INSERT INTO workspace_settings VALUES('ui_preferences','{"productId":"p"}');
 INSERT INTO sources(id,product_id,kind,title,hash,retrieved_at) VALUES('s','p','note','Brief','test','now');
 INSERT INTO memory_entities(id,product_id,type,data_json,source_id,updated_at) VALUES('r','p','fact','{"text":"Local draft"}','s','now');`);
      const sync = new MemorySync(db, () => "p"),
        base = { kind: "workspace", productId: "p", version: 1 } as const;
      const provider = {
        async memoryField() {
          return {
            workspace: "fixture",
            remote: { kind: "value" as const, value: "Remote draft" },
          };
        },
      };
      await sync.run(
        {
          ...base,
          action: "link-memory",
          record: "r",
          field: "text",
          label: "Sync status",
          url: "https://www.notion.so/11111111111141118111111111111111",
        },
        provider,
      );
      const link = sync.list("p")[0]!;
      await sync.run(
        {
          ...base,
          action: "sync-memory-field",
          link: link.id,
          review: link,
          choice: "refresh",
        },
        provider,
      );
    } finally {
      db.close();
    }
    app = await launch();
    let page = await app.firstWindow();
    const region = page.getByRole("region", { name: "Notion memory sync" });
    await expect(region).toContainText("conflict");
    await expect(region).toContainText("Remote draft");
    await region.getByLabel("Local value").fill("Retained offline edit");
    await region.getByRole("button", { name: "Save local edit" }).click();
    await expect(region).toContainText("pending");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByLabel("Local value")).toHaveValue(
      "Retained offline edit",
    );
    await page
      .getByRole("button", { name: "Keep local value and unlink" })
      .click();
    await expect(page.getByLabel("Local value")).toHaveCount(0);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(
      page.getByRole("region", { name: "Product context" }),
    ).toContainText("Retained offline edit");
    await expect(page.getByLabel("Local value")).toHaveCount(0);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
