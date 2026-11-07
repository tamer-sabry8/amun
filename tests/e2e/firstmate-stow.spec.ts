import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, realpath, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("stow measures a new real Firstmate home and records the empty sweep", async () => {
  test.setTimeout(90000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "amun-stow-")));
  const binary = process.env.AMUN_PACKAGED_PATH;
  const app = await electron.launch({
    ...(binary ? { executablePath: binary } : {}),
    args: [...(binary ? [] : ["apps/desktop"]), "--user-data-dir=" + root],
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("status")).toHaveText("Connected");
    for (const name of ["Open conversations", "Open Pi commands"])
      await page.getByRole("button", { name, exact: true }).click();
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("stow", { timeout: 2000 });
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    const result = page.getByTestId("native-pi-result");
    await expect(result).toContainText("Startup memory", { timeout: 60000 });
    const owner = (
      await readFile(join(root, "workspace/firstmate-crew-home"), "utf8")
    ).trim();
    const receipt = await readFile(
      join(root, "workspace", owner, "git/primary/data/stow-receipt.md"),
      "utf8",
    );
    expect(receipt).toContain("learnings.md");
    expect(receipt).toContain("within-budget");
    const data = join(root, "workspace", owner, "git/primary/data"),
      marker = "Disposable local memory fixture";
    await writeFile(join(data, "learnings.md"), marker);
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(result).toContainText("still needs curation", {
      timeout: 60000,
    });
    expect(await readFile(join(data, "learnings.md"), "utf8")).toBe(marker);
    expect(await readFile(join(data, "stow-receipt.md"), "utf8")).not.toContain(
      marker,
    );
  } finally {
    await app.close();
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
});
