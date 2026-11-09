import { test, expect } from "@playwright/test";
import { access, lstat } from "node:fs/promises";
import { join } from "node:path";
import { launchMacWorkspace } from "../support/mac-workspace.ts";
import { reach } from "../support/keyboard.ts";
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
    expect(
      db
        .prepare("SELECT count(*) FROM sources WHERE kind='repo'")
        .pluck()
        .get(),
    ).toBe(0);
  } finally {
    db.close();
  }
  const app = await launchMacWorkspace(root);
  try {
    const page = await app.firstWindow();
    await expect(page.locator("#service-status")).toHaveText("Connected");
    const backlog = page.getByRole("button", { name: "Backlog", exact: true });
    await reach(page, backlog);
    await page.keyboard.press("Enter");
    const story = page
      .getByRole("article")
      .filter({
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
