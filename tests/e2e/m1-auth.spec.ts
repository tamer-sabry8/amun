import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("built Pi login prompts in the UI and stores an API-key canary only in private auth state", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-auth-ui-"));
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
    await expect(page.getByRole("status")).toHaveText("Connected");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("tab", { name: "Models", exact: true }).click();
    await page
      .getByLabel("Provider", { exact: true })
      .selectOption("openai:api_key");
    await page.getByRole("button", { name: "Sign in with Pi" }).click();
    const prompt = page.getByRole("dialog", { name: "Complete sign-in" });
    // Cold packaged SDK startup is distinct from shell readiness.
    await expect(prompt).toBeVisible({ timeout: 20000 });
    const canary = "CANARY-AMUN-API-KEY-ONLY-PRIVATE";
    await prompt.locator("input").fill(canary);
    await prompt.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      page.locator(".plain-list li").filter({ hasText: "OpenAI API key" }),
    ).toContainText("configured");
    await expect(prompt).not.toBeVisible();
    const path = join(root, "pi-agent/auth.json");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, "utf8")).toContain(canary);
    expect(
      (await readFile(join(root, "workspace/workspace.sqlite"))).includes(
        Buffer.from(canary),
      ),
    ).toBe(false);
    expect(await page.locator("body").innerText()).not.toContain(canary);
    await page
      .getByRole("button", { name: "Check provider readiness" })
      .click();
    await expect(
      page.locator(".plain-list li").filter({ hasText: "OpenAI API key" }),
    ).toContainText("configured");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
