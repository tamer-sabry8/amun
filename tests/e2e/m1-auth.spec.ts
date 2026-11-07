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
test("Copilot enterprise text prompt permits github.com default without inventing a company URL", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-copilot-prompt-"));
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
    await page.getByRole("button", { name: "Sign in with Pi" }).click();
    const prompt = page.getByRole("dialog", { name: "Complete sign-in" });
    await expect(prompt).toBeVisible({ timeout: 20000 });
    await expect(prompt.locator("input")).toHaveValue("");
    await expect(prompt).toContainText(
      "Your repository server may use a different address",
    );
    await expect(
      page.getByRole("button", { name: "Sign in with Pi", exact: true }),
    ).toBeDisabled();
    await expect(
      prompt.getByRole("button", { name: "Continue", exact: true }),
    ).toBeEnabled();
    await prompt.locator("input").fill("https://ghes.tahaluf.ae/");
    await prompt.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "No browser was opened.",
    );
    await expect(prompt).not.toBeVisible();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("native login and confirmed logout affect only the disposable Amun Pi credential", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-native-auth-ui-"));
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
    await page
      .getByRole("button", { name: "Open conversations", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open Pi commands", exact: true })
      .click();
    await page.getByLabel("Native Pi command").selectOption("login");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await page
      .getByTestId("native-pi-result")
      .getByRole("button", { name: "OpenAI API key", exact: true })
      .click();
    const prompt = page.getByRole("dialog", { name: "Complete sign-in" });
    await expect(prompt).toBeVisible({ timeout: 20000 });
    const canary = "CANARY-NATIVE-LOGOUT-PRIVATE";
    await prompt.locator("input").fill(canary);
    await prompt.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(prompt).not.toBeVisible();
    await page.getByLabel("Native Pi command").selectOption("logout");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    const result = page.getByTestId("native-pi-result");
    await expect(
      result.getByRole("button", { name: "openai", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await result.getByRole("button", { name: "openai", exact: true }).click();
    expect(await readFile(join(root, "pi-agent/auth.json"), "utf8")).toContain(
      canary,
    );
    await result
      .getByRole("button", { name: "Confirm sign-out", exact: true })
      .click();
    await expect(result).toContainText("Signed out of openai");
    expect(
      await readFile(join(root, "pi-agent/auth.json"), "utf8"),
    ).not.toContain(canary);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
