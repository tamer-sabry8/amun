import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acceptanceDrafts } from "../support/ado-acceptance-drafts.ts";
import { launchMacWorkspace } from "../support/mac-workspace.ts";

test("shell starts without loading proof, PRD, diff or terminal tools until needed", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-startup-modules-"));
  await acceptanceDrafts(
    root,
    "https://example.invalid/Collection/",
    "Startup fixture",
  );
  const app = await launchMacWorkspace(root);
  try {
    const page = await app.firstWindow();
    await expect(page.locator("#service-status")).toHaveText("Connected");
    const debuggerSession = await page.context().newCDPSession(page);
    const scripts: string[] = [];
    debuggerSession.on("Debugger.scriptParsed", ({ url }) => {
      if (url.startsWith("file:"))
        scripts.push(new URL(url).pathname.split("/").at(-1)!);
    });
    await debuggerSession.send("Debugger.enable");
    const loaded = () => scripts;
    expect(
      (await loaded()).filter((name) =>
        /^(proof|gallery|prd-workspace|terminal-pane|xterm|editor\.api)-/.test(
          name,
        ),
      ),
    ).toEqual([]);
    await page
      .getByRole("complementary", { name: "Workspace navigation" })
      .getByRole("button", { name: "PRD", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Visual mode", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Visual PRD editor" }),
    ).toBeVisible();
    expect(await loaded()).toEqual(
      expect.arrayContaining([expect.stringMatching(/^prd-workspace-/)]),
    );
    await page.getByRole("button", { name: "Terminal", exact: true }).click();
    await expect(page.locator(".xterm-helper-textarea")).toHaveCount(1);
    expect(await loaded()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^terminal-pane-/),
        expect.stringMatching(/^xterm-/),
      ]),
    );
    expect(
      (await loaded()).filter((name) =>
        /^(proof|gallery|editor\.api)-/.test(name),
      ),
    ).toEqual([]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
