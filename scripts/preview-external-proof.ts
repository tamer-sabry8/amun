import { _electron as electron, expect } from "@playwright/test";
import { createServer } from "node:http";
import { resolve } from "node:path";
let chromeVisited = false;
const server = createServer((req, res) => {
  const agent = req.headers["user-agent"] ?? "";
  if (req.url === "/go") {
    res.writeHead(302, { Location: "https://accounts.google.com/auth" });
    res.end();
    return;
  }
  if (
    agent.includes("Chrome/") &&
    !agent.includes("Electron/") &&
    !agent.includes("Edg/")
  )
    chromeVisited = true;
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<h1>Amun external handoff acceptance</h1><p>This local proof page can be closed.</p><a href="/go">Test handoff</a>',
  );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
if (!address || typeof address === "string") throw Error();
const url = `http://127.0.0.1:${address.port}/`;
const app = await electron.launch({
  executablePath: resolve(
    `apps/desktop/out/Amun-darwin-${process.arch}/Amun.app/Contents/MacOS/Amun`,
  ),
  args: [],
  chromiumSandbox: true,
});
try {
  await app.evaluate(({ session }) => {
    session
      .fromPartition("persist:amun-browser-m0")
      .webRequest.onBeforeRequest(
        { urls: ["https://accounts.google.com/*"] },
        (_d, cb) => cb({ cancel: true }),
      );
  });
  const page = await app.firstWindow();
  await expect(page.getByRole("status")).toHaveText("Connected");
  await page.getByLabel("M0 browser proof").fill(url);
  await page.getByRole("button", { name: "Open browser", exact: true }).click();
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
  await page
    .getByRole("button", { name: "Open in Chrome", exact: true })
    .click();
  await expect.poll(() => chromeVisited, { timeout: 15000 }).toBe(true);
  console.log(
    JSON.stringify({
      packaged: true,
      nativeChromeHandoff: true,
      originalAppURLVisited: true,
      identityProviderNetworkRequestsAllowed: false,
      cookiesTransferred: false,
    }),
  );
} finally {
  await app.close();
  await new Promise<void>((r) => server.close(() => r()));
}
