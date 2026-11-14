import { test, expect, _electron as electron } from "@playwright/test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "../../packages/data/src/database.ts";
import { WorkStore } from "../../packages/data/src/work-store.ts";

const Database = createRequire(resolve("packages/data/package.json"))(
  "better-sqlite3",
);

// Renaming and deleting a product, a project, a task and an RFP from the
// work's own menu, in the app, on a disposable profile with no connections.
// Adding each kind is covered by the main journey (rebuild-shell.spec.ts).
const launch = (root: string) =>
  electron.launch({
    args: [
      ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
      "--user-data-dir=" + root,
    ],
    ...(process.env.AMUN_PACKAGED_PATH
      ? { executablePath: process.env.AMUN_PACKAGED_PATH }
      : {}),
    chromiumSandbox: true,
    env: { ...(process.env as Record<string, string>), AMUN_LEGACY_SHELL: "0" },
  });

const works = [
  ["product", "Test Product 1", "Arabic Voice"],
  ["project", "Old project", "New project"],
  ["task", "Old task", "New task"],
  ["rfp", "Old RFP", "New RFP"],
] as const;

test("each kind of work is renamed and deleted from its menu", async () => {
  test.setTimeout(180_000);
  const root = await mkdtemp(join(tmpdir(), "amun-work-crud-"));
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    await mkdir(join(root, "workspace"), { mode: 0o700 });
    const db = new Database(join(root, "workspace", "workspace.sqlite"));
    migrate(db);
    const store = new WorkStore(db);
    const send = (action: string, extra: Record<string, unknown>) => {
      const result = store
        .handle({ version: 1, kind: "work", action, ...extra })
        .find((event) => event.kind === "work-result");
      if (!result?.ok) throw Error(action + ": " + result?.message);
      return result.ref;
    };
    send("finish-setup", {
      workTypes: ["product", "project", "task", "rfp"],
      tools: [],
      agents: [],
      groups: [{ name: "Work", routes: [] }],
    });
    const groupId = store.snapshot().groups[0]!.id;
    for (const [type, name] of works)
      if (type === "rfp") send("save-rfp", { groupId, name, client: "DMT" });
      else send("create-area", { groupId, type, name });
    db.close();
    await chmod(join(root, "workspace", "workspace.sqlite"), 0o600);

    app = await launch(root);
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1360, height: 860 });
    const nav = page.getByRole("navigation", { name: "Amun" });
    const home = () => nav.getByRole("button", { name: "Home" }).click();
    const card = (name: string) =>
      page.locator(".rb-workcard", { hasText: name });
    await expect(card("Test Product 1")).toBeVisible({ timeout: 30_000 });

    for (const [, before, after] of works) {
      await home();
      await card(before).click();
      const crumb = page.locator(".rb-crumb");
      // Rename from the menu
      await crumb.getByRole("button", { name: before }).click();
      await page.getByRole("menuitem", { name: "Rename" }).click();
      const field = page.getByRole("textbox", { name: "Name of this work" });
      await field.fill(after);
      await field.press("Enter");
      await expect(crumb.getByRole("button", { name: after })).toBeVisible();
      // The new name is what Home shows, and the old one is gone
      await home();
      await expect(card(after)).toBeVisible();
      await expect(card(before)).toHaveCount(0);
      // Delete asks first; "Keep it" changes nothing
      await card(after).click();
      await crumb.getByRole("button", { name: after }).click();
      await page.getByRole("menuitem", { name: "Delete…" }).click();
      await page.getByRole("menuitem", { name: "Keep it" }).click();
      await expect(crumb.getByRole("button", { name: after })).toBeVisible();
      // Delete for real: back on Home, and it is not there
      await page.getByRole("menuitem", { name: "Delete…" }).click();
      await page.getByRole("menuitem", { name: "Delete it" }).click();
      await expect(
        page.getByRole("heading", { level: 1 }).first(),
      ).not.toHaveText(after);
      await expect(card(after)).toHaveCount(0);
    }
    // Nothing is left, and the deleted RFP is gone from its own screen too
    await home();
    await expect(page.locator(".rb-workcard")).toHaveCount(0);
    await nav.getByRole("button", { name: "RFPs" }).click();
    await expect(page.getByText("New RFP")).toHaveCount(0);

    // And they stay gone after a restart
    await app.close();
    app = await launch(root);
    const again = await app.firstWindow();
    await expect(again.getByRole("navigation", { name: "Amun" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(again.locator(".rb-workcard")).toHaveCount(0);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
