import { test, expect, _electron as electron } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, realpath, readFile, rm } from "node:fs/promises";
test("native Calm toggles the pinned Firstmate preference across app restarts", async () => {
  test.setTimeout(100000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "amun-calm-e2e-")));
  const executablePath = process.env.AMUN_PACKAGED_PATH;
  try {
    for (const mode of ["on", "off"]) {
      const app = await electron.launch({
        ...(executablePath ? { executablePath } : {}),
        args: [
          ...(executablePath ? [] : ["apps/desktop"]),
          "--user-data-dir=" + root,
        ],
      });
      try {
        const p = await app.firstWindow();
        const btn = (name: string) =>
          p.getByRole("button", { name, exact: true });
        await expect(p.locator("#service-status")).toHaveText("Connected");
        await btn("Open conversations").click();
        await btn("Open Pi commands").click();
        await btn("Read active conversation").click();
        await expect(p.getByLabel("Conversation message")).toBeVisible({
          timeout: 20000,
        });
        await expect(p.getByText(/non-text or internal entries/)).toHaveCount(
          mode === "on" ? 1 : 0,
          { timeout: 2000 },
        );
        await p.getByLabel("Conversation message").fill("/calm");
        await btn("Run /calm").click({ timeout: 2000 });
        await expect(p.getByTestId("native-pi-result")).toContainText(
          "Firstmate Calm is " + mode,
          { timeout: 30000 },
        );
        await btn("Read active conversation").click();
        await expect(p.getByLabel("Conversation message")).toBeVisible({
          timeout: 20000,
        });
        await expect(p.getByText(/non-text or internal entries/)).toHaveCount(
          mode === "on" ? 0 : 1,
          { timeout: 2000 },
        );
        const ws = join(root, "workspace");
        const dir = await readFile(join(ws, "firstmate-crew-home"), "utf8");
        expect(
          await readFile(join(ws, dir, "git/primary/config/calm"), "utf8"),
        ).toBe(mode + "\n");
      } finally {
        await app.close();
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
