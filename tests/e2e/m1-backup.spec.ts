import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("native picker backup roundtrip uses the service and preserves an existing destination", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-backup-ui-"));
  const archive = join(root, "proof.amunbackup"),
    target = join(root, "restored");
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
    await page.getByRole("tab", { name: "Data and backup" }).click();
    await app.evaluate(({ dialog }, archive) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: archive,
      });
    }, archive);
    await page
      .getByLabel("Backup passphrase")
      .fill("acceptance-only passphrase");
    await page.getByRole("button", { name: "Export encrypted backup" }).click();
    await expect(
      page.getByText("Encrypted backup exported.", { exact: true }),
    ).toBeVisible();
    const bytes = await readFile(archive);
    expect(bytes.subarray(0, 8).toString()).toBe("AMUNB001");
    expect(bytes.includes(Buffer.from("acceptance-only passphrase"))).toBe(
      false,
    );
    await expect(page.getByLabel("Backup passphrase")).toHaveValue("");
    await app.evaluate(
      ({ dialog }, { archive, target }) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [archive],
        });
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: target,
        });
      },
      { archive, target },
    );
    await page
      .getByLabel("Backup passphrase")
      .fill("acceptance-only passphrase");
    await page.getByRole("button", { name: "Restore to new folder" }).click();
    await expect(
      page.getByText(
        "Workspace restored to the new folder. Your current workspace is unchanged.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      (await readFile(join(target, "workspace.sqlite")))
        .subarray(0, 15)
        .toString(),
    ).toBe("SQLite format 3");
    await page
      .getByLabel("Backup passphrase")
      .fill("acceptance-only passphrase");
    await page.getByRole("button", { name: "Restore to new folder" }).click();
    await expect(
      page.getByText("Backup operation failed.", { exact: false }),
    ).toBeVisible();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
