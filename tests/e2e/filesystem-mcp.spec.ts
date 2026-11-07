import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, mkdir, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Filesystem MCP lists only the chosen folder and cancels without granting another", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "amun-folder-mcp-")),
  );
  const chosen = join(root, "chosen");
  await mkdir(chosen);
  await writeFile(join(chosen, "within-selection.txt"), "");
  await writeFile(join(root, "outside-selection.txt"), "");
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
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, chosen);
    await button("Local disk and external drives").click();
    const result = page.getByTestId("native-pi-result");
    await expect(result).toContainText("within-selection.txt");
    await expect(result).not.toContainText("outside-selection.txt");
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
    await button("Run command").click();
    await button("Local disk and external drives").click();
    await expect(result).toContainText("Folder selection cancelled.");
    await expect(result).not.toContainText("within-selection.txt");
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
