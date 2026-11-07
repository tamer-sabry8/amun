import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test.use({ actionTimeout: 5000 });
test("native import reviews scope and imports a real pinned SDK session", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-import-ui-"));
  const app = await electron.launch({
    args: process.env.AMUN_PACKAGED_PATH
      ? ["--user-data-dir=" + root]
      : ["apps/desktop", "--user-data-dir=" + root],
    ...(process.env.AMUN_PACKAGED_PATH
      ? { executablePath: process.env.AMUN_PACKAGED_PATH }
      : {}),
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("status")).toHaveText("Connected");
    await page
      .getByRole("button", { name: "Open conversations", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open Pi commands", exact: true })
      .click();
    const header = {
      type: "session",
      version: 3,
      id: "11111111-1111-4111-8111-111111111111",
      timestamp: "2026-11-06T00:00:00Z",
      cwd: "/unavailable/original-workspace",
    };
    const text =
      JSON.stringify(header) +
      "\n" +
      JSON.stringify({
        type: "session_info",
        id: "abcd1234",
        parentId: null,
        timestamp: header.timestamp,
        name: "Native import acceptance",
      }) +
      "\n";
    await page
      .getByLabel("Import Pi session JSONL", { exact: false })
      .setInputFiles({
        name: "session.jsonl",
        mimeType: "application/jsonl",
        buffer: Buffer.from(text),
      });
    await expect(
      page.getByRole("heading", { name: "Review session import" }),
    ).toBeVisible();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      header.cwd,
    );
    await page
      .getByRole("button", { name: "Confirm import into Amun", exact: true })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "ID retained; original file unchanged",
    );
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("name");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Native import acceptance",
    );
    await page
      .getByLabel("Import Pi session JSONL", { exact: false })
      .setInputFiles({
        name: "session.jsonl",
        mimeType: "application/jsonl",
        buffer: Buffer.from(text),
      });
    await expect(
      page.getByRole("heading", { name: "Review session import" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Confirm import into Amun", exact: true })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "could not be completed",
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
