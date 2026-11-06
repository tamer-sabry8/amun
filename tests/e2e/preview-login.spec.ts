import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
test("direct first-party login survives full app restart in the isolated partition", async () => {
  const token = randomBytes(24).toString("hex");
  const root = await mkdtemp(join(tmpdir(), "amun-preview-login-"));
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "POST" && req.url === "/login") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 1024) req.destroy();
      });
      req.on("end", () => {
        if (body !== "password=acceptance-only") {
          res.writeHead(403);
          res.end("Denied");
          return;
        }
        res.writeHead(303, {
          "Set-Cookie": `proof=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`,
          Location: "/",
        });
        res.end();
      });
      return;
    }
    const signed = (req.headers.cookie ?? "")
      .split("; ")
      .includes(`proof=${token}`);
    res.end(
      signed
        ? "<h1>Signed in to acceptance app</h1>"
        : '<form method="POST" action="/login"><input name="password" type="password"><button>Sign in</button></form>',
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error();
  const url = `http://127.0.0.1:${address.port}/`;
  const launch = () =>
    electron.launch({
      args: [
        "--amun-proof",
        ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
        "--user-data-dir=" + root,
      ],
      ...(process.env.AMUN_PACKAGED_PATH
        ? { executablePath: process.env.AMUN_PACKAGED_PATH }
        : {}),
      chromiumSandbox: true,
    });
  let app = await launch();
  const open = async () => {
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
  };
  const text = () =>
    app.evaluate(
      ({ webContents }, url) =>
        webContents
          .getAllWebContents()
          .find((w) => w.getURL() === url)!
          .executeJavaScript("document.body.innerText"),
      url,
    );
  try {
    await open();
    await expect.poll(text).toContain("Sign in");
    await app.evaluate(
      ({ webContents }, url) =>
        webContents
          .getAllWebContents()
          .find((w) => w.getURL() === url)!
          .executeJavaScript(
            "document.querySelector('input').value='acceptance-only';document.querySelector('form').requestSubmit()",
          ),
      url,
    );
    await expect.poll(text).toContain("Signed in to acceptance app");
    await app.close();
    app = await launch();
    await open();
    await expect.poll(text).toContain("Signed in to acceptance app");
    const isolated = await app.evaluate(async ({ session }, url) => {
      const response = await session
        .fromPartition("persist:amun-browser-other-proof")
        .fetch(url);
      return response.text();
    }, url);
    expect(isolated).toContain("Sign in");
    expect(isolated).not.toContain("Signed in to acceptance app");
  } finally {
    await app.close();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
