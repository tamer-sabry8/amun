import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
test("known IdP redirect is blocked, then user restarts auth externally from original page", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/go") {
      res.writeHead(302, {
        Location: "https://accounts.google.com/o/oauth2/auth?state=private",
      });
      res.end();
    } else res.end('<a href="/go">Sign in</a>');
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error();
  const url = `http://127.0.0.1:${addr.port}/`;
  const app = await electron.launch({
    args: process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"],
    ...(process.env.AMUN_PACKAGED_PATH
      ? { executablePath: process.env.AMUN_PACKAGED_PATH }
      : {}),
    chromiumSandbox: true,
  });
  try {
    await app.evaluate(({ session, shell }) => {
      (globalThis as unknown as { providerRequests: number }).providerRequests =
        0;
      // Fail-safe network interception: test never contacts a real identity provider.
      session
        .fromPartition("persist:amun-browser-m0")
        .webRequest.onBeforeRequest(
          { urls: ["https://accounts.google.com/*"] },
          (_details, cb) => {
            (globalThis as unknown as { providerRequests: number })
              .providerRequests++;
            cb({ cancel: true });
          },
        );
      (globalThis as unknown as { opened: string[] }).opened = [];
      shell.openExternal = async (url) => {
        (globalThis as unknown as { opened: string[] }).opened.push(url);
      };
    });
    const page = await app.firstWindow();
    await expect(page.getByRole("status")).toHaveText("Connected");
    await page.getByLabel("M0 browser proof").fill(url);
    await page
      .getByRole("button", { name: "Open browser", exact: true })
      .click();
    await expect
      .poll(() =>
        app.evaluate(
          ({ webContents }, url) =>
            webContents.getAllWebContents().some((w) => w.getURL() === url),
          url,
        ),
      )
      .toBe(true);
    await app.evaluate(
      ({ webContents }, url) =>
        webContents
          .getAllWebContents()
          .find((w) => w.getURL() === url)!
          .executeJavaScript("document.querySelector('a').click()"),
      url,
    );
    await expect(page.locator("#browser-handoff")).toBeVisible();
    await expect(page.locator("#browser-handoff")).not.toContainText("state=");
    expect(
      await app.evaluate(
        () => (globalThis as unknown as { opened: string[] }).opened,
      ),
    ).toEqual([]);
    await page
      .getByRole("button", { name: "Open in default browser", exact: true })
      .click();
    await expect
      .poll(() =>
        app.evaluate(
          () => (globalThis as unknown as { opened: string[] }).opened,
        ),
      )
      .toEqual([url]);
    await app.evaluate(
      ({ webContents }, url) =>
        webContents
          .getAllWebContents()
          .find((w) => w.getURL() === url)!
          .executeJavaScript("window.open('https://accounts.google.com/auth')"),
      url,
    );
    await expect(page.locator("#browser-handoff")).toBeVisible();
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    await app.evaluate(
      ({ webContents }, url) =>
        webContents
          .getAllWebContents()
          .find((w) => w.getURL() === url)!
          .executeJavaScript(
            "const f=document.createElement('iframe');f.src='https://accounts.google.com/embedded';document.body.append(f)",
          ),
      url,
    );
    await expect(page.locator("#browser-handoff")).toBeHidden();
    expect(
      await app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .some((w) => w.getURL().startsWith("https://accounts.google.com")),
      ),
    ).toBe(false);
    await page.waitForTimeout(300);
    expect(
      await app.evaluate(
        () =>
          (globalThis as unknown as { providerRequests: number })
            .providerRequests,
      ),
    ).toBe(0);
  } finally {
    await app.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
