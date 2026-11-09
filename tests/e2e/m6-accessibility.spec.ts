import { test, expect, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { acceptanceDrafts } from "../support/ado-acceptance-drafts.ts";
import { openWorkspace } from "../../packages/data/src/workspace.ts";
import { launchMacWorkspace } from "../support/mac-workspace.ts";

import { reach } from "../support/keyboard.ts";
for (const theme of ["tamer-sabry-default", "navy-gold", "navy-cyan"]) {
  test(
    "keyboard navigation and primary screen accessibility in " + theme,
    async () => {
      test.setTimeout(180000);
      const root = await mkdtemp(join(tmpdir(), "amun-accessibility-"));
      const context = await acceptanceDrafts(
        root,
        "https://example.invalid/Collection/",
        "Onboarding",
      );
      const db = openWorkspace(
        join(root, "workspace"),
        createRequire(resolve("packages/data/package.json"))("better-sqlite3"),
      );
      db.prepare("UPDATE products SET name=? WHERE id=?").run(
        "Team onboarding",
        context.productId,
      );
      db.prepare(
        "INSERT OR REPLACE INTO workspace_settings VALUES('ui_preferences',?)",
      ).run(JSON.stringify({ productId: context.productId, theme }));
      db.close();
      const app = await launchMacWorkspace(root);
      try {
        const page = await app.firstWindow();
        await expect(page.locator("#service-status")).toHaveText("Connected");
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await page.setViewportSize({ width: 1200, height: 778 });
        const nav = page.getByRole("complementary", {
          name: "Workspace navigation",
        });
        const scan = async (label: string) => {
          const results = await new AxeBuilder({ page })
            .setLegacyMode(true)
            .analyze();
          const violations = results.violations
            .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
            .map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }));
          expect.soft(violations, label).toEqual([]);
          if (process.env.AMUN_T055_CAPTURE) {
            await page.screenshot({
              path: join(process.env.AMUN_T055_CAPTURE, theme, label + ".png"),
              animations: "disabled",
              scale: "css",
            });
          }
        };

        for (const label of [
          "PRD",
          "Backlog",
          "Sprint",
          "PRs",
          "Agents",
          "Decisions",
          "Priorities",
          "Requests",
          "Artifacts",
          "Settings",
          "Overview",
        ]) {
          const button = nav.getByRole("button", {
            name: new RegExp("^" + label + "(?: [0-9]+)?$"),
          });
          await reach(page, button);
          await page.keyboard.press("Enter");
          await expect(
            page.getByRole("heading", { name: label, level: 1, exact: true }),
          ).toBeVisible();
          await scan(label);
        }
        const activate = async (target: Locator) => {
          await reach(page, target);
          await page.keyboard.press("Enter");
        };
        await activate(page.getByText("Stakeholder update", { exact: true }));
        await activate(
          page.getByRole("button", { name: "Draft from source records" }),
        );
        await activate(
          page.getByRole("button", {
            name: "Review exact content and destination",
          }),
        );
        const approve = page.getByRole("button", {
          name: "Approve exact PDF export",
        });
        await expect(approve).toBeVisible();
        await scan("Stakeholder review");
        await activate(approve);
        await expect(page.getByText(/PDF saved to/)).toBeVisible();
        await activate(
          nav.getByRole("button", { name: "Browser", exact: true }),
        );
        await expect(
          page.getByRole("complementary", { name: "Inspector", exact: true }),
        ).toBeVisible();
        await scan("Browser");
        await activate(page.getByRole("button", { name: "Close inspector" }));
        await activate(
          nav.getByRole("button", { name: "Terminal", exact: true }),
        );
        await expect(
          page.getByRole("region", { name: "Terminal dock" }),
        ).toBeVisible();
        await scan("Terminal");
        await activate(page.getByRole("button", { name: "Close terminal" }));
        const selector = page.getByRole("combobox", {
          name: "Product",
          exact: true,
        });
        await reach(page, selector);
        await page.keyboard.press("p");
        await page.keyboard.press("Tab");
        await expect(
          page.getByRole("region", { name: "Portfolio overview" }),
        ).toBeVisible();
        await scan("Portfolio");
        const convo = page.getByRole("button", {
          name: "Open conversations",
          exact: true,
        });
        await reach(page, convo);
        await page.keyboard.press("Enter");
        await expect(
          page.getByRole("heading", { name: "Conversations", level: 1 }),
        ).toBeVisible();
        await scan("Conversations");
      } finally {
        await app.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
}
