import { test, expect, type Locator } from "@playwright/test";
import { access, lstat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launchMacWorkspace } from "../support/mac-workspace.ts";
import { reach } from "../support/keyboard.ts";
import {
  materializeDeliveryTree,
  deliveryHead,
} from "../../packages/crew/src/delivery-worktree.ts";
import { acceptanceDb } from "../support/ado-acceptance-drafts.ts";

test("keyboard journey resumes the saved story and reaches implementation repository selection", async () => {
  const root = process.env.AMUN_T054_PROFILE;
  test.skip(!root, "Requires the preserved keyboard acceptance profile.");
  if (!root || !/^\/private\/tmp\/amun-m6-keyboard-[A-Za-z0-9]+$/.test(root))
    throw Error("Invalid acceptance profile");
  const stat = await lstat(root);
  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid!() ||
    stat.mode & 0o077
  )
    throw Error("Unsafe acceptance profile");
  await access(join(root, "commitment-verified.json"));
  await access(join(root, "deletion-verified.json"));
  test.setTimeout(90000);
  const checkout = process.env.AMUN_T054_CHECKOUT;
  const db = acceptanceDb(root);
  try {
    expect(
      db
        .prepare(
          "SELECT count(*) FROM work_items WHERE type='story' AND status='committed'",
        )
        .pluck()
        .get(),
    ).toBe(6);
  } finally {
    db.close();
  }
  const app = await launchMacWorkspace(root);
  try {
    const page = await app.firstWindow();
    await expect(page.locator("#service-status")).toHaveText("Connected");
    const activate = async (control: Locator) => {
      await reach(page, control);
      await page.keyboard.press("Enter");
    };
    const enter = async (control: Locator, value: string) => {
      await reach(page, control);
      await page.keyboard.press("Meta+a");
      await page.keyboard.insertText(value);
    };
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    if (checkout) {
      expect(checkout).toBe("/Users/tamersabry/Projects/amun");
      await activate(button("Overview"));
      const context = page.getByRole("region", { name: "Product context" });
      if (
        !(await context
          .getByText("TEST implementation repository", { exact: false })
          .count())
      ) {
        await reach(page, context.getByLabel("Source type"));
        await page.keyboard.press("r");
        await page.keyboard.press("Tab");
        await enter(
          context.getByLabel("Source title"),
          "TEST implementation repository",
        );
        await enter(
          context.getByLabel("Source reference"),
          "https://github.com/tamer-sabry8/amun.git",
        );
        await activate(
          context.getByRole("button", { name: "Map source", exact: true }),
        );
      }
      await expect(context).toContainText(
        "https://github.com/tamer-sabry8/amun.git",
      );
    }
    const backlog = page.getByRole("button", { name: "Backlog", exact: true });
    await reach(page, backlog);
    await page.keyboard.press("Enter");
    const story = page.getByRole("article").filter({
      has: page.getByRole("heading", {
        name: "Revoke Invitation",
        exact: true,
      }),
    });
    await expect(story).toBeVisible();
    const implement = story.getByRole("button", {
      name: "Ask Firstmate to implement",
      exact: true,
    });
    await reach(page, implement);
    await page.keyboard.press("Enter");
    const scope = story.getByRole("region", { name: "Implementation scope" });
    await expect(scope.getByRole("status")).toHaveText(
      "Select a repository and its local checkout.",
    );
    const repo = scope.getByLabel("Implementation repository");
    await reach(page, repo);
    if (checkout) {
      await page.keyboard.press("t");
      await page.keyboard.press("Tab");
      await reach(page, scope.getByLabel("Branch purpose"));
      await page.keyboard.press("t");
      await page.keyboard.press("Tab");
      await enter(scope.getByLabel("Local repository checkout"), checkout);
      await activate(
        scope.getByRole("button", {
          name: "Preview implementation scope",
          exact: true,
        }),
      );
      await expect(scope.getByRole("status")).toHaveText(
        "Review the commit, branch and worktree before starting.",
        { timeout: 30000 },
      );
      const state = acceptanceDb(root);
      try {
        const row = state
          .prepare(
            "SELECT payload_json,payload_hash,state FROM actions WHERE kind='implementation_scope' ORDER BY rowid DESC LIMIT 1",
          )
          .get() as {
          payload_json: string;
          payload_hash: string;
          state: string;
        };
        expect(row.state).toBe("pending_approval");
        const payload = JSON.parse(row.payload_json);
        expect(payload.story).toBe("42343384-de5d-48de-8d03-355cb5fa76ea");
        expect(payload.scope.source).toBe(checkout);
        expect(payload.scope.remote).toBe(
          "https://github.com/tamer-sabry8/amun.git",
        );
        expect(payload.scope.branch).toMatch(/^test\/story-/);
        await expect(scope).toContainText(payload.scope.head);
        await expect(scope).toContainText(payload.scope.branch);
        await expect(scope).toContainText(payload.scope.worktree);
        await materializeDeliveryTree(
          join(root, "workspace", "delivery"),
          payload.scope,
        );
        expect(
          await deliveryHead(
            join(root, "workspace", "delivery"),
            payload.scope,
          ),
        ).toBe(payload.scope.head);
        await writeFile(
          join(root, "implementation-review.json"),
          JSON.stringify({ ...payload, binding: row.payload_hash }, null, 2),
          { mode: 0o600 },
        );
      } finally {
        state.close();
      }
      return;
    }
    await expect(repo.locator("option")).toHaveText(["Select repository"]);
    await expect(
      scope.getByRole("button", {
        name: "Preview implementation scope",
        exact: true,
      }),
    ).toBeDisabled();
  } finally {
    await app.close();
  }
});
