import { _electron as electron, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
const packaged = process.argv.includes("--packaged");
const authPath = join(homedir(), ".pi/agent/auth.json");
const hash = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");
const before = hash(await readFile(authPath));
const app = await electron.launch({
  args: packaged ? [] : ["apps/desktop"],
  ...(packaged
    ? {
        executablePath: resolve(
          `apps/desktop/out/Amun-darwin-${process.arch}/Amun.app/Contents/MacOS/Amun`,
        ),
      }
    : {}),
  env: { HOME: homedir(), PATH: "", TMPDIR: process.env.TMPDIR ?? "/tmp" },
  chromiumSandbox: true,
});
try {
  const page = await app.firstWindow();
  await expect(page.getByRole("status")).toHaveText("Connected");
  for (const [provider, label] of [
    ["openrouter", "Use Pi OpenRouter"],
    ["github-copilot", "Use Pi GitHub Copilot"],
  ]) {
    await page.getByRole("button", { name: label!, exact: true }).click();
    await expect(page.locator("#pi-status")).toHaveText("ready", {
      timeout: 30000,
    });
    await expect(page.locator("#pi-models")).toContainText("available models");
    await page
      .getByLabel("Pi prompt", { exact: true })
      .fill("Reply with exactly AMUN_OK. Do not use tools.");
    await page.getByRole("button", { name: "Send to Pi", exact: true }).click();
    await expect(page.locator("#pi-status")).toHaveText("complete", {
      timeout: 60000,
    });
    await expect(page.locator("#pi-output")).toHaveText("AMUN_OK");
    console.log(
      JSON.stringify({
        provider,
        packaged,
        throughServiceAndRenderer: true,
        modelListObserved: true,
        successfulStopAndSettled: true,
        expectedRenderedReply: true,
        emptyPath: true,
      }),
    );
    await page.getByRole("button", { name: "Close Pi", exact: true }).click();
    await expect(page.locator("#pi-status")).toHaveText("closed");
  }
} catch {
  console.error("Pi UI inference acceptance failed; provider output withheld");
  process.exitCode = 1;
} finally {
  await app.close();
  const unchanged = hash(await readFile(authPath)) === before;
  console.log(JSON.stringify({ personalCredentialFileUnchanged: unchanged }));
  if (!unchanged) process.exitCode = 1;
}
