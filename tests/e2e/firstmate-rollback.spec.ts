import { test, expect, _electron as electron } from "@playwright/test";
import {
  access,
  mkdtemp,
  rm,
  realpath,
  readFile,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { catalog } from "../../packages/contracts/src/firstmate-release.ts";

test("one-click rollback survives restart and prepares the retained source without changing existing worktrees", async () => {
  const executablePath = process.env.AMUN_PACKAGED_PATH;
  test.setTimeout(180000);
  const resources = executablePath
    ? resolve(dirname(executablePath), "../Resources/firstmate-archives")
    : resolve("apps/desktop/.runtime/firstmate-archives");
  if (!executablePath) {
    try {
      await access(join(resources, "catalog.json"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      test.skip(true, "Run firstmate:stage for source archive acceptance.");
    }
  }
  const { current, previous } = catalog.parse(
    JSON.parse(await readFile(join(resources, "catalog.json"), "utf8")),
  );
  expect(previous).toBeTruthy();
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "amun-rollback-e2e-")),
  );
  const launch = () =>
    electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [
        ...(executablePath ? [] : ["apps/desktop"]),
        "--user-data-dir=" + root,
      ],
      chromiumSandbox: true,
    });
  let app = await launch();
  try {
    const panel = async () => {
      const page = await app.firstWindow();
      await page.getByTestId("tool-tile").filter({ hasText: "Agents" }).click();
      return page.getByRole("region", { name: "Firstmate runtime" });
    };
    let view = await panel();
    // A loaded full-suite run can make one release operation time out; the
    // product reports that with a fixed message, so click again (bounded).
    const failed = "Firstmate release operation failed.";
    const attempt = async (
      button: string,
      expected: string,
      timeout: number,
    ) => {
      const status = view.getByRole("status");
      for (let tries = 1; ; tries++) {
        await view
          .getByRole("button", { name: button })
          .click({ timeout: 3000 });
        await expect(status).toContainText(
          new RegExp(
            expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "|" + failed,
          ),
          { timeout },
        );
        if (!(await status.innerText()).includes(failed) || tries === 3) break;
      }
      await expect(status).toContainText(expected, { timeout: 1000 });
      return status;
    };
    const prepare = async (pin: typeof current) => {
      const prefix = "Prepared Firstmate " + pin.commit + " at ";
      const status = await attempt("Prepare Firstmate worktree", prefix, 60000);
      const home = (await status.innerText()).slice(prefix.length);
      expect(home.startsWith(root + "/workspace/firstmate-home-")).toBe(true);
      expect((await lstat(join(home, ".git"))).isFile()).toBe(true);
      const file = "bin/backends/herdr.sh";
      const source = execFileSync("/usr/bin/tar", [
        "-xzOf",
        join(resources, pin.commit + ".tgz"),
        "firstmate-" + pin.commit + "/" + file,
      ]);
      expect((await readFile(join(home, file))).equals(source)).toBe(true);
      return { home, file, source };
    };
    await expect(view.getByRole("status")).toContainText(current.commit);
    const openCrew = async () => {
      const status = await attempt(
        "Open persistent crew home",
        "Crew home for " + current.commit + " at ",
        60000,
      );
      return (await status.innerText()).split(" at ")[1]!;
    };
    const crew = await openCrew();
    const original = await prepare(current);
    await attempt(
      "Roll back to previous Firstmate",
      "Restored Firstmate revision " + previous!.commit,
      30000,
    );
    await app.close();
    app = await launch();
    view = await panel();
    await expect(view.getByRole("status")).toContainText(
      "Selected Firstmate revision " + previous!.commit,
    );
    expect(await openCrew()).toBe(crew);
    const retained = await prepare(previous!);
    expect(retained.home).not.toBe(original.home);
    expect(
      (await readFile(join(original.home, original.file))).equals(
        original.source,
      ),
    ).toBe(true);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
