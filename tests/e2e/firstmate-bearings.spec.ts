import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test, expect, _electron as electron } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mkdtemp,
  realpath,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
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
  let closeBoard: (() => Promise<void>) | undefined;
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
    // Loading the conversation can reset the draft on a slow machine, so
    // type the command again until the composer offers to run it.
    const runBearings = page.getByRole("button", {
      name: "Run /bearings",
      exact: true,
    });
    await expect(async () => {
      await page
        .getByLabel("Conversation message", { exact: true })
        .fill("/skill:bearings");
      await expect(runBearings).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 60000 });
    const output = page.getByTestId("native-pi-result");
    // Under a loaded full-suite run the crew snapshot can time out once; the
    // product reports that with this fixed message, so run the command again.
    const unavailable = "Crew snapshot unavailable.";
    const settle = async (run: () => Promise<void>, expected: string) => {
      for (let attempt = 1; ; attempt++) {
        await run();
        await expect(output).toContainText(
          new RegExp(expected + "|" + unavailable),
          { timeout: 45000 },
        );
        if (!(await output.innerText()).includes(unavailable)) break;
        if (attempt === 3) break;
      }
      await expect(output).toContainText(expected);
    };
    await settle(
      // Running clears the draft, so a repeat goes through the command selector.
      (() => {
        let first = true;
        return () => {
          if (!first) return invoke("");
          first = false;
          return runBearings.click();
        };
      })(),
      "No recent completions are in the current baseline.",
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
    await settle(
      () => invoke("file include PRs"),
      "Saved to data/status-report-",
    );
    const files = (await readdir(dir)).filter((n) =>
      /^status-report-\d{4}-\d\d-\d\d\.md$/.test(n),
    );
    expect(files).toHaveLength(1);
    expect(await readFile(join(dir, files[0]!), "utf8")).toContain(
      "PR discovery:",
    );
    if (process.env.AMUN_LIVE_LAVISH === "1") {
      await writeFile(
        join(dir, "backlog.md"),
        "## In flight\n\n## Queued\n\n- [ ] mate-decision-pilot - Choose pilot (repo: sample) (kind: captain) (hold: choose pilot) (hold-kind: captain)\n\n## Done\n",
        { mode: 0o600 },
      );
      closeBoard = async () => {
        const crewOwner = join(workspace, owner.trim()),
          home = join(crewOwner, "git/primary"),
          state = join(crewOwner, "lavish");
        const port = (
          await readFile(join(state, "port"), "utf8").catch(() => "")
        ).trim();
        if (!/^\d{4,5}$/.test(port)) return;
        const env = {
          HOME: crewOwner,
          FM_HOME: home,
          FM_ROOT_OVERRIDE: home,
          PATH: process.env.PATH,
          LAVISH_AXI_HOST: "127.0.0.1",
          LAVISH_AXI_PORT: port,
          LAVISH_AXI_STATE_DIR: state,
          LAVISH_AXI_NO_OPEN: "1",
        };
        const board = join(home, ".lavish/bearings-board.html");
        await promisify(execFile)(
          "/bin/bash",
          [join(home, "bin/fm-procevent-lavish.sh"), "retire", board],
          { cwd: home, env, timeout: 20000 },
        ).catch(() => {});
        await promisify(execFile)("lavish-axi", ["stop"], {
          cwd: home,
          env,
          timeout: 10000,
        }).catch(() => {});
      };
      await invoke("lavish");
      await expect(
        page.getByRole("button", { name: "Open local Bearings board" }),
      ).toBeVisible({ timeout: 65000 });
      await page
        .getByRole("button", { name: "Open local Bearings board" })
        .click();
      await expect
        .poll(() =>
          app.evaluate(({ webContents }) =>
            webContents
              .getAllWebContents()
              .some((w) =>
                /^http:\/\/127\.0\.0\.1:\d+\/session\/[a-f0-9]+$/.test(
                  w.getURL(),
                ),
              ),
          ),
        )
        .toBe(true);
      await expect
        .poll(
          () =>
            app.evaluate(async ({ webContents }) => {
              const preview = webContents
                .getAllWebContents()
                .find((w) =>
                  /^http:\/\/127\.0\.0\.1:\d+\/session\//.test(w.getURL()),
                );
              const artifact = preview?.mainFrame.frames.find((f) =>
                f.url.includes("/artifact/"),
              );
              return artifact?.executeJavaScript(
                "Boolean(document.querySelector('input[name=note]'))",
              );
            }),
          { timeout: 12000 },
        )
        .toBe(true);
      await app.evaluate(async ({ webContents }) => {
        const preview = webContents
          .getAllWebContents()
          .find((w) =>
            /^http:\/\/127\.0\.0\.1:\d+\/session\//.test(w.getURL()),
          )!;
        const artifact = preview.mainFrame.frames.find((f) =>
          f.url.includes("/artifact/"),
        )!;
        await artifact.executeJavaScript(
          "const answer=document.querySelector('input[name=note]'); answer.value='Use the local pilot'; answer.form.requestSubmit();",
        );
      });
      await expect
        .poll(
          () =>
            app.evaluate(async ({ webContents }) => {
              const view = webContents
                .getAllWebContents()
                .find((w) => w.getURL().includes("/session/"))!;
              return view.executeJavaScript(
                "var send=document.querySelector('#send'); if(send && !send.disabled){send.click();true}else{false}",
              );
            }),
          { timeout: 10000 },
        )
        .toBe(true);
      await expect
        .poll(() => readFile(join(dir, "backlog.md"), "utf8"), {
          timeout: 30000,
        })
        .toMatch(/\[x\] mate-decision-pilot/);
    }
  } finally {
    await closeBoard?.();
    await app.close();
    await rm(root, {
      force: true,
      recursive: true,
      maxRetries: 12,
      retryDelay: 200,
    });
  }
});
