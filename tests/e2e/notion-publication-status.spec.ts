import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, mkdirSync, chmodSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "../../packages/data/src/database.ts";
import { NotionConversationReview } from "../../packages/data/src/notion-review.ts";
const Database = createRequire(resolve("packages/data/package.json"))(
  "better-sqlite3",
);
test("workspace-scoped publication remains visible without a misleading workspace error", async () => {
  const root = mkdtempSync(join(tmpdir(), "amun-publication-status-"));
  mkdirSync(join(root, "workspace"), { mode: 0o700 });
  const file = join(root, "workspace/workspace.sqlite");
  const db = new Database(file);
  migrate(db);
  const review = new NotionConversationReview(db, {
    create: async () => ({ state: "unknown" as const }),
  });
  const item = review.prepare(
    { title: "Test", text: "Reviewed fixture" },
    {
      title: "Documents",
      parentId: "11111111-1111-4111-8111-111111111111",
      parentType: "page_id",
      titleProperty: "title",
    },
    "workspace",
  );
  db.prepare("UPDATE actions SET state='executing' WHERE id=?").run(item.id);
  db.close();
  chmodSync(file, 0o600);
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
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("The workspace change could not be completed.", {
        exact: false,
      }),
    ).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("conversation sharing is outside model settings", async () => {
  const root = mkdtempSync(join(tmpdir(), "amun-conversation-route-"));
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
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("tab", { name: "Models", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Open Pi commands", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Sign in to Codex CLI", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page
      .getByRole("button", { name: "Open conversations", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open Pi commands", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Share to Notion", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign in to Codex CLI", exact: true }),
    ).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
