import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, realpath, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("captain starts real primary supervision, enters away posture and resumes the owner after quit", async () => {
  test.setTimeout(180000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "amun-posture-")));
  const launch = () =>
    electron.launch({
      ...(process.env.AMUN_PACKAGED_PATH
        ? { executablePath: process.env.AMUN_PACKAGED_PATH }
        : {}),
      args: [
        ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
        "--user-data-dir=" + root,
      ],
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const commands = async () => {
      await expect(page.getByRole("status")).toHaveText("Connected");
      await page
        .getByRole("button", { name: "Open conversations", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Open Pi commands", exact: true })
        .click();
    };
    const invoke = async (name: string, arg = "") => {
      await page
        .getByLabel("Native Pi command", { exact: true })
        .selectOption(name, { timeout: 2000 });
      await page.getByLabel("Command argument", { exact: true }).fill(arg);
      await page
        .getByRole("button", { name: "Run command", exact: true })
        .click();
    };
    await commands();
    await invoke("afk", "Review the disposable queue while I am away.");
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Away posture is active",
      { timeout: 60000 },
    );
    const owner = (
      await readFile(join(root, "workspace/firstmate-crew-home"), "utf8")
    ).trim();
    const state = join(root, "workspace", owner, "git/primary/state");
    expect(await readFile(join(state, ".afk-contract"), "utf8")).toContain(
      "disposable queue",
    );
    const pid = Number((await readFile(join(state, ".lock"), "utf8")).trim());
    await app.close();
    await expect
      .poll(
        () => {
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 12000 },
      )
      .toBe(false);
    app = await launch();
    page = await app.firstWindow();
    await commands();
    await expect
      .poll(
        async () => {
          const next = Number(
            await readFile(join(state, ".lock"), "utf8").catch(() => "0"),
          );
          if (next <= 1 || next === pid) return false;
          try {
            process.kill(next, 0);
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 40000 },
      )
      .toBe(true);
    await invoke("quiet", "off");
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "attended",
      { timeout: 60000 },
    );
    await invoke("afk", "return");
    await expect
      .poll(async () =>
        readFile(join(state, ".afk-contract"), "utf8").catch(() => ""),
      )
      .toBe("");
    await expect(
      page.getByRole("button", { name: "Run command", exact: true }),
    ).toBeEnabled({ timeout: 30000 });
    await invoke("ahoy");
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Captain’s Call",
      { timeout: 90000 },
    );
  } finally {
    await app.close().catch(() => {});
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 15,
      retryDelay: 200,
    });
  }
});
