import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, rm, chmod, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "../../packages/data/src/database.ts";
import { WorkspaceService } from "../../packages/data/src/workspace-service.ts";
test("PRD editor imports, round-trips, autosaves history and exports Markdown through the Mac shell", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-m2-editor-"));
  await mkdir(join(root, "workspace"), { mode: 0o700 });
  const path = join(root, "workspace/workspace.sqlite");
  const Database = createRequire(resolve("packages/data/package.json"))(
    "better-sqlite3",
  );
  const db = new Database(path);
  try {
    migrate(db);
    const ws = new WorkspaceService(db);
    ws.handle({
      version: 1,
      kind: "workspace",
      action: "create-product",
      name: "Editor acceptance",
      allowedModels: ["local/test"],
    });
    const productId = ws.snapshot().preferences.productId!;
    ws.handle({
      version: 1,
      kind: "workspace",
      action: "map-source",
      productId,
      sourceKind: "document",
      reference: "brief.md",
      title: "Brief",
    });
    const sourceId = ws.snapshot().productContext!.sources[0]!.id;
    const result = await ws.author(
      {
        version: 1,
        kind: "product-authoring",
        action: "interview",
        productId,
        model: "local/test",
        objective: "Review the editor",
      },
      async () =>
        JSON.stringify({
          question: "What should round-trip?",
          sourceIds: [sourceId],
        }),
    );
    expect(result.kind).toBe("workspace-snapshot");
  } finally {
    db.close();
  }
  await chmod(path, 0o600);
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
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    await expect(page.locator("#service-status")).toHaveText("Connected");
    await button("PRD").click();
    const markdown =
      "# Editor requirements\n\n- [ ] Review **sources**\n\n| Stage | Owner |\n| --- | --- |\n| Review | PM |";
    await page.getByLabel("Import PRD Markdown").setInputFiles({
      name: "brief.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(markdown),
    });
    await expect(page.getByText("Saved v1", { exact: true })).toBeVisible();
    await button("Visual mode").click();
    const visual = page.getByRole("textbox", { name: "Visual PRD editor" });
    await expect(
      visual.getByRole("heading", { name: "Editor requirements" }),
    ).toBeVisible();
    await expect(visual.locator("table")).toContainText("Review");
    await visual.click();
    await page.keyboard.press("Meta+End");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await page.keyboard.type(" confirmed");
    await expect(page.getByText("Saved v2", { exact: true })).toBeVisible();
    await button("Markdown mode").click();
    const editor = page.getByRole("textbox", {
      name: "PRD Markdown",
      exact: true,
    });
    const saved = await editor.inputValue();
    expect(saved).toContain("confirmed");
    await editor.focus();
    await editor.press("Meta+a");
    await expect(
      page.getByRole("complementary", { name: "Selection tools" }),
    ).toBeVisible();
    const destination = join(root, "export.md");
    await app.evaluate(({ session }, path) => {
      session.defaultSession.once("will-download", (_e, item) =>
        item.setSavePath(path),
      );
    }, destination);
    await button("Export Markdown").click();
    await expect
      .poll(() => readFile(destination, "utf8").catch(() => ""))
      .toBe(saved);
    await page.getByText("Version history (2)", { exact: true }).click();
    await expect(page.getByText("Version 1", { exact: true })).toBeVisible();
    await page.getByLabel("Import PRD Markdown").setInputFiles({
      name: "unsupported.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("<kbd>retain this text</kbd>"),
    });
    await expect(
      page.getByText("This formatting requires Markdown mode."),
    ).toBeVisible();
    await expect(editor).toHaveValue("<kbd>retain this text</kbd>");
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
