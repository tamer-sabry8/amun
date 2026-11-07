import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Google Sheets and Maps verify their live tools from Conversations", async () => {
  test.skip(
    process.env.AMUN_LIVE_GOOGLE_MCP !== "1",
    "Requires the live Google MCP endpoint",
  );
  const root = await mkdtemp(join(tmpdir(), "amun-sheets-"));
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
    await button("Google Sheets").click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Google Sheets MCP tools verified. Access to your account still requires Google authorization.",
      { timeout: 15000 },
    );
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("mcp");
    await button("Run command").click();
    await button("Google Maps").click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Google Maps MCP tools verified. Place searches require a configured Google Maps project and credentials.",
      { timeout: 15000 },
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
