import { test, expect, _electron as electron } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtempSync, mkdirSync, chmodSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "../../packages/data/src/database.ts";
import { AttentionStore } from "../../packages/data/src/attention-store.ts";
import { attentionItem } from "../../packages/contracts/src/entities.ts";
const Database = createRequire(resolve("packages/data/package.json"))(
  "better-sqlite3",
);
test("shared request queue persists navigation, supports search, Focus restore and keyboard drawers", async () => {
  test.setTimeout(90000);
  const root = mkdtempSync(join(tmpdir(), "amun-requests-"));
  mkdirSync(join(root, "workspace"), { mode: 0o700 });
  const file = join(root, "workspace/workspace.sqlite");
  const db = new Database(file);
  migrate(db);
  db.prepare("INSERT INTO products(id,name,created_at) VALUES (?,?,?)").run(
    "p",
    "Acceptance product",
    "now",
  );
  const store = new AttentionStore(db);
  for (const [id, type] of [
    ["approval", "approve"],
    ["review", "review"],
    ["answer", "answer"],
  ] as const)
    store.create(
      attentionItem.parse({
        id,
        productId: "p",
        type,
        origin: { kind: "firstmate", label: "Firstmate", firstmateRef: null },
        ask: `${type} acceptance request`,
        detail: "Acceptance fixture",
        blocking: [],
        primaryAction: {
          label: type === "answer" ? "Answer question" : "Open request",
          mode: type === "answer" ? "inline" : "navigate",
          intent: type === "answer" ? "answer" : "open_request",
          targetRef: id,
        },
        governed: type === "approve",
        state: "open",
        snoozedUntil: null,
        createdAt: "2026-11-06T00:00:00Z",
      }),
    );
  db.close();
  chmodSync(file, 0o600);
  const app = await electron.launch({
    args: [
      ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
      "--force-device-scale-factor=1",
      "--force-color-profile=srgb",
      "--user-data-dir=" + root,
    ],
    ...(process.env.AMUN_PACKAGED_PATH
      ? { executablePath: process.env.AMUN_PACKAGED_PATH }
      : {}),
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1200, height: 778 });
    await expect(page.getByTestId("requests-count")).toHaveText("3");
    await expect(page.getByTestId("island")).toHaveAttribute("data-count", "3");
    await page.keyboard.press("Meta+Shift+j");
    await expect(
      page
        .getByTestId("island")
        .getByRole("button", { name: "Open request", exact: true }),
    ).toBeFocused();
    await page
      .getByTestId("island")
      .getByRole("button", { name: "Open request", exact: true })
      .click();
    await expect(
      page.getByRole("complementary", { name: "Inspector", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "This request needs its dedicated approval review. Opening it does not approve or execute it.",
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await expect(page.getByTestId("requests-count")).toHaveText("3");
    await page.getByRole("button", { name: "Focus", exact: true }).click();
    expect(
      (await page
        .getByRole("complementary", { name: "Workspace navigation" })
        .boundingBox())!.width,
    ).toBe(68);
    await expect(
      page.getByRole("complementary", { name: "Inspector", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Exit Focus", exact: true }).click();
    await expect(
      page.getByRole("complementary", { name: "Inspector", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close inspector" }).click();
    await page.keyboard.press("Meta+k");
    await page
      .getByLabel("Search entities and commands")
      .fill("review acceptance");
    await expect(
      page
        .getByRole("dialog", { name: "Command palette" })
        .getByRole("button", { name: "review acceptance request request" }),
    ).toBeVisible();
    await page
      .getByRole("dialog", { name: "Command palette" })
      .getByRole("button", { name: "review acceptance request request" })
      .click();
    await page.getByRole("button", { name: "Mark reviewed" }).click();
    await expect(page.getByTestId("requests-count")).toHaveText("2");
    await page.getByRole("button", { name: "+1 more", exact: true }).click();
    const inline = page.locator('[data-item-id="answer"]');
    await inline
      .getByRole("button", { name: "Answer question", exact: true })
      .click();
    await inline
      .getByLabel("Answer", { exact: true })
      .fill("Keep the current scope");
    await inline
      .getByRole("button", { name: "Save answer", exact: true })
      .click();
    await expect(page.getByTestId("requests-count")).toHaveText("1");

    await page.getByLabel("State", { exact: true }).selectOption("resolved");
    await expect(page.locator(".request-row")).toHaveCount(2);
    await page.getByRole("button", { name: "Close inspector" }).click();
    for (const theme of ["tamer-sabry-default", "navy-gold", "navy-cyan"]) {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("tab", { name: "Appearance" }).click();
      await page.getByLabel("Theme").selectOption(theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      for (const [i, label] of [
        "Notifications",
        "Activity",
        "Artifacts",
        "Downloads",
        "Skills and extensions",
      ].entries()) {
        await page.keyboard.press(`Alt+Meta+Digit${i + 1}`);
        await expect(page.getByTestId("drawer")).toHaveCount(1);
        await expect(page.getByTestId("drawer")).toHaveAccessibleName(label);
        await page.keyboard.press("Tab");
        expect(
          await page
            .getByTestId("drawer")
            .evaluate((element) => element.contains(document.activeElement)),
        ).toBe(true);
        await expect(page.getByTestId("drawer")).toHaveScreenshot(
          `drawer-${theme}-${i}.png`,
          { scale: "css", animations: "disabled" },
        );
        const result = await new AxeBuilder({ page })
          .setLegacyMode(true)
          .analyze();
        expect(
          result.violations.filter((v) =>
            ["serious", "critical"].includes(v.impact ?? ""),
          ),
        ).toEqual([]);
        await page.keyboard.press("Escape");
        await expect(page.getByTestId("drawer")).toHaveCount(0);
      }
    }
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
