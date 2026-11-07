import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Browser adapters report a blank isolated Chrome session", async () => {
  test.setTimeout(90000);
  test.skip(
    process.env.AMUN_LIVE_BROWSER_MCP !== "1",
    "Requires Google Chrome on this Mac",
  );
  const root = await mkdtemp(join(tmpdir(), "amun-browser-mcp-"));
  const executablePath = process.env.AMUN_PACKAGED_PATH;
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [
      ...(executablePath ? [] : ["apps/desktop"]),
      "--user-data-dir=" + root,
    ],
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator("#service-status")).toHaveText("Connected");
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    await button("Open conversations").click();
    await button("Open Pi commands").click();
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("mcp");
    await button("Run command").click();
    for (const name of ["Playwright", "Chrome DevTools", "Puppeteer"]) {
      await button(name).click();
      await expect(page.getByTestId("native-pi-result")).toContainText(
        name + " verified a blank page in an isolated Chrome session.",
        { timeout: 20000 },
      );
      if (name !== "Puppeteer") await button("Run command").click();
    }
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
