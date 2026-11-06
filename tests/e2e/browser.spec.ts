import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";

test("browser isolates a local prototype, redirects, popups, permissions and service ports", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { Location: "/prototype" });
      response.end();
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(
      `<h1>Local prototype</h1><script>window.receivedPorts=0;addEventListener('message',e=>window.receivedPorts+=e.ports.length);</script>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No local server");
  const url = `http://127.0.0.1:${address.port}/redirect`;
  const app = await electron.launch({
    args: process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"],
    ...(process.env.AMUN_PACKAGED_PATH
      ? { executablePath: process.env.AMUN_PACKAGED_PATH }
      : {}),
    chromiumSandbox: true,
  });
  try {
    const shell = await app.firstWindow();
    await expect(shell.getByRole("status")).toHaveText("Connected");
    await shell.getByLabel("M0 browser proof").fill(url, { timeout: 3000 });
    await shell.getByRole("button", { name: "Open browser" }).click();
    await expect
      .poll(() =>
        app.evaluate(({ webContents }) =>
          webContents
            .getAllWebContents()
            .some((w) => w.getURL().endsWith("/prototype")),
        ),
      )
      .toBe(true);
    const result = await app.evaluate(async ({ webContents, session }) => {
      const web = webContents
        .getAllWebContents()
        .find((w) => w.getURL().endsWith("/prototype"));
      if (!web) throw new Error("No browser view");
      const isolation = await web.executeJavaScript(
        `({require:typeof require,process:typeof process,ipc:typeof ipcRenderer,ports:window.receivedPorts,opener:window.opener===null})`,
      );
      await web.executeJavaScript(
        `window.postMessage({kind:'amun-browser-command',command:{action:'close'}},'*');window.postMessage({kind:'amun-port'},'*');`,
      );
      const permission = await web.executeJavaScript(
        `navigator.permissions.query({name:'notifications'}).then(p=>p.state)`,
      );
      const popup = await web.executeJavaScript(
        `window.open('https://example.com')===null`,
      );
      return {
        isolation,
        permission,
        popup,
        separate: web.session !== session.defaultSession,
      };
    });
    expect(result).toEqual({
      isolation: {
        require: "undefined",
        process: "undefined",
        ipc: "undefined",
        ports: 0,
        opener: true,
      },
      permission: "denied",
      popup: true,
      separate: true,
    });
    await expect(shell.locator("#browser-status")).toContainText(
      "Popup blocked",
    );
    await expect(shell.getByRole("status")).toHaveText("Connected");
    await shell
      .getByRole("button", { name: "Close browser", exact: true })
      .click();
    await expect
      .poll(() =>
        app.evaluate(
          ({ webContents }) =>
            webContents
              .getAllWebContents()
              .filter((w) => w.getURL().includes("/prototype")).length,
        ),
      )
      .toBe(0);
  } finally {
    await app.close();
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
