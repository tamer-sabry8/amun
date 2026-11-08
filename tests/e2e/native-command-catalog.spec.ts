import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
test("every pinned Pi builtin and required Firstmate command is available in Conversations", async () => {
  const binary = process.env.AMUN_PACKAGED_PATH;
  const runtime = binary
    ? join(dirname(dirname(binary)), "Resources/pi")
    : resolve("runtime/pi");
  const entry = join(
    runtime,
    "node_modules/@earendil-works/pi-coding-agent/dist/core/slash-commands.js",
  );
  const { BUILTIN_SLASH_COMMANDS } = (await import(
    pathToFileURL(entry).href
  )) as { BUILTIN_SLASH_COMMANDS: { name: string }[] };
  const expected = [
    ...BUILTIN_SLASH_COMMANDS.map((c) => c.name),
    "llama",
    "mcp",
    "debug",
    "afk",
    "quiet",
    "ahoy",
    "stow",
    "bearings",
    "calm",
    "supervision-model",
    "updatefirstmate",
  ];
  const root = await mkdtemp(join(tmpdir(), "amun-catalog-"));
  const app = await electron.launch({
    ...(binary ? { executablePath: binary } : {}),
    args: [...(binary ? [] : ["apps/desktop"]), "--user-data-dir=" + root],
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("status")).toHaveText("Connected");
    for (const name of ["Open conversations", "Open Pi commands"])
      await page.getByRole("button", { name, exact: true }).click();
    const choices = page
      .getByLabel("Native Pi command", { exact: true })
      .locator("option");
    const names = await choices.evaluateAll((options) =>
      options.map((o) => (o as HTMLOptionElement).value),
    );
    expect(names.sort()).toEqual([...new Set(expected)].sort());
  } finally {
    await app.close();
    await rm(root, {
      force: true,
      recursive: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
});
