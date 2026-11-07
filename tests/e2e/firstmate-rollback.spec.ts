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
    const prepare = async (pin: typeof current) => {
      await view
        .getByRole("button", { name: "Prepare Firstmate worktree" })
        .click();
      const status = view.getByRole("status");
      const prefix = "Prepared Firstmate " + pin.commit + " at ";
      await expect(status).toContainText(prefix, { timeout: 60000 });
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
      await view
        .getByRole("button", { name: "Open persistent crew home" })
        .click({ timeout: 3000 });
      const status = view.getByRole("status");
      await expect(status).toContainText(
        "Crew home for " + current.commit + " at ",
        { timeout: 60000 },
      );
      return (await status.innerText()).split(" at ")[1]!;
    };
    const crew = await openCrew();
    const original = await prepare(current);
    await view
      .getByRole("button", { name: "Roll back to previous Firstmate" })
      .click();
    await expect(view.getByRole("status")).toContainText(
      "Restored Firstmate revision " + previous!.commit,
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
