import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
const app = await electron.launch({
  executablePath: resolve(
    `apps/desktop/out/Amun-darwin-${process.arch}/Amun.app/Contents/MacOS/Amun`,
  ),
  args: [],
  chromiumSandbox: true,
});
try {
  const page = await app.firstWindow();
  await page.getByLabel("M0 browser proof").fill("https://github.com/login");
  await page.getByRole("button", { name: "Open browser" }).click();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w?.show();
    w?.focus();
  });
  console.log(
    JSON.stringify({
      state: "awaiting_user_sign_in",
      site: "https://github.com",
      packaged: true,
      cookiesImported: false,
    }),
  );
  const inspect = () =>
    app.evaluate(async ({ webContents, session }) => {
      const web = webContents.getAllWebContents().find((w) => {
        try {
          return new URL(w.getURL()).hostname === "github.com";
        } catch {
          return false;
        }
      });
      if (!web) return { authenticated: false };
      const state = await web.executeJavaScript(
        `({authenticated:!!document.querySelector('meta[name="user-login"]')?.getAttribute('content'),require:typeof require,process:typeof process,ipc:typeof ipcRenderer,opener:window.opener===null})`,
      );
      return {
        ...state,
        separateSession: web.session !== session.defaultSession,
      };
    });
  async function waitAuthenticated(timeout: number) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const state = await inspect();
        if (state.authenticated) return state;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("User sign-in not verified before timeout");
  }
  const first = await waitAuthenticated(900000);
  console.log(
    JSON.stringify({ state: "authenticated_page_verified", ...first }),
  );
  await page
    .getByRole("button", { name: "Close browser", exact: true })
    .click();
  await page.getByLabel("M0 browser proof").fill("https://github.com/");
  await page.getByRole("button", { name: "Open browser" }).click();
  const reopened = await waitAuthenticated(30000);
  console.log(
    JSON.stringify({
      state: "authenticated_view_reopened",
      ...reopened,
      credentialValuesRead: false,
      cookiesRead: false,
    }),
  );
  if (
    first.require !== "undefined" ||
    first.process !== "undefined" ||
    first.ipc !== "undefined" ||
    !first.opener ||
    !first.separateSession
  )
    throw new Error("Browser isolation acceptance failed");
  console.log(
    "PASS: user-authenticated GitHub rendered inside packaged Amun and persisted across view recreation.",
  );
} finally {
  await app.close();
}
