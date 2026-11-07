import { test, expect, _electron as electron } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, realpath, readFile, readdir, rm } from "node:fs/promises";
test("native Bearings reads the persistent crew and writes a report only on request", async () => {
  test.setTimeout(150000);
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "amun-bearings-e2e-")),
  );
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
    await expect(page.getByRole("status")).toHaveText("Connected");
    await page
      .getByRole("button", { name: "Open conversations", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open Pi commands", exact: true })
      .click();
    const invoke = async (argument: string) => {
      await page
        .getByLabel("Native Pi command", { exact: true })
        .selectOption("bearings");
      await page.getByLabel("Command argument", { exact: true }).fill(argument);
      await page
        .getByRole("button", { name: "Run command", exact: true })
        .click();
    };
    await page
      .getByRole("button", { name: "Read active conversation", exact: true })
      .click();
    await page
      .getByLabel("Conversation message", { exact: true })
      .fill("/skill:bearings");
    await page
      .getByRole("button", { name: "Run /bearings", exact: true })
      .click();

    const output = page.getByTestId("native-pi-result");
    await expect(output).toContainText(
      "No recent completions are in the current baseline.",
      { timeout: 45000 },
    );
    const workspace = join(root, "workspace");
    const owner = await readFile(
      join(workspace, "firstmate-crew-home"),
      "utf8",
    );
    const dir = join(workspace, owner, "git/primary/data");
    expect(
      (await readdir(dir)).filter((n) => n.startsWith("status-report-")),
    ).toEqual([]);
    await invoke("file include PRs");
    await expect(output).toContainText("Saved to data/status-report-", {
      timeout: 45000,
    });
    const files = (await readdir(dir)).filter((n) =>
      /^status-report-\d{4}-\d\d-\d\d\.md$/.test(n),
    );
    expect(files).toHaveLength(1);
    expect(await readFile(join(dir, files[0]!), "utf8")).toContain(
      "PR discovery:",
    );
  } finally {
    await app.close();
    await rm(root, { force: true, recursive: true });
  }
});
