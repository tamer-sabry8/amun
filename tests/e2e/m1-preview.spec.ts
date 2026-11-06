import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("native preview fits its inspector and hides behind overlays without reloading", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-preview-shell-"));
  const server = createServer((_req, res) =>
    res.end("<h1>Preview fixture</h1>"),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error();
  const url = `http://127.0.0.1:${address.port}/`;
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
    await page.getByRole("button", { name: "Browser", exact: true }).click();
    await page.getByLabel("Preview URL").fill(url);
    await page.getByRole("button", { name: "Open preview" }).click();
    await expect
      .poll(() =>
        app.evaluate(({ webContents }) =>
          webContents
            .getAllWebContents()
            .some((w) => w.getURL().startsWith("http://127.0.0.1:")),
        ),
      )
      .toBe(true);
    const before = await app.evaluate(({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0]!.contentView.children[0]!;
      return { bounds: view.getBounds(), visible: view.getVisible() };
    });
    expect(before.visible).toBe(true);
    expect(before.bounds.width).toBeLessThanOrEqual(360);
    await page.keyboard.press("Meta+k");
    await expect(
      page.getByRole("dialog", { name: "Command palette" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.contentView.children[0]!.getVisible(),
        ),
      )
      .toBe(false);
    await page.keyboard.press("Escape");
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.contentView.children[0]!.getVisible(),
        ),
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "Activity drawer", exact: true })
      .click();
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.contentView.children[0]!.getVisible(),
        ),
      )
      .toBe(false);
    await page.keyboard.press("Escape");
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.contentView.children[0]!.getVisible(),
        ),
      )
      .toBe(true);
    await app.evaluate(({ webContents }) => {
      const web = webContents
        .getAllWebContents()
        .find((w) => w.getURL().startsWith("http://127.0.0.1:"))!;
      web.focus();
      web.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    });
    await expect(
      page.getByRole("complementary", { name: "Inspector", exact: true }),
    ).toHaveCount(0);
    expect(
      await app.evaluate(
        ({ webContents }) =>
          webContents
            .getAllWebContents()
            .filter((w) => w.getURL().startsWith("http://127.0.0.1:")).length,
      ),
    ).toBe(1);
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
