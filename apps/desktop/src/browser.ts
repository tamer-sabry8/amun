import { BrowserWindow, WebContentsView, session, ipcMain } from "electron";
import {
  browserCommand,
  browserPartition,
  browserURL,
} from "./browser-policy.js";
import { windowPreferences } from "./security.js";

/** M0 proof surface only. Web pages receive neither preload nor service ports. */
export function installBrowser(window: BrowserWindow, product: string): void {
  let view: WebContentsView | undefined;
  const partition = browserPartition(product);
  const browserSession = session.fromPartition(partition);
  browserSession.setPermissionRequestHandler((_contents, _permission, answer) =>
    answer(false),
  );
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.setDevicePermissionHandler(() => false);
  const denyDownload = (event: Electron.Event) => event.preventDefault();
  browserSession.on("will-download", denyDownload);
  const layout = () => {
    const [width = 0, height = 0] = window.getContentSize();
    view?.setBounds({ x: 0, y: 240, width, height: Math.max(0, height - 240) });
  };
  const close = () => {
    if (!view) return;
    window.contentView.removeChildView(view);
    view.webContents.close();
    view = undefined;
  };
  const notify = (message: string) => {
    if (!window.isDestroyed())
      window.webContents.send("amun-browser-status", message);
  };
  const ensure = () => {
    if (view) return view;
    view = new WebContentsView({
      webPreferences: {
        ...windowPreferences,
        partition,
        allowRunningInsecureContent: false,
        webviewTag: false,
      },
    });
    const contents = view.webContents;
    // Popups never gain an opener or a privileged window; redirect-based SSO is supported.
    contents.setWindowOpenHandler(() => {
      notify("Popup blocked. Use a sign-in flow that redirects in this view.");
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (!browserURL(url)) event.preventDefault();
    });
    contents.on("will-redirect", (event, url) => {
      if (!browserURL(url)) event.preventDefault();
    });
    contents.on("will-frame-navigate", (event) => {
      if (!browserURL(event.url)) event.preventDefault();
    });
    contents.on("did-navigate", () => notify("Page loaded"));
    contents.on(
      "did-fail-load",
      (_event, code, _description, _url, isMainFrame) => {
        if (isMainFrame && code !== -3) notify("Page could not be loaded");
      },
    );
    window.contentView.addChildView(view);
    layout();
    return view;
  };
  const handle = (event: Electron.IpcMainEvent, input: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      return;
    const command = browserCommand(input);
    if (!command) {
      notify("Navigation refused");
      return;
    }
    if (command.action === "close") {
      close();
      notify("Browser closed");
      return;
    }
    if (command.action === "navigate" && command.url) {
      void ensure()
        .webContents.loadURL(command.url)
        .catch(() => notify("Page could not be loaded"));
    } else if (view) {
      const history = view.webContents.navigationHistory;
      if (command.action === "back" && history.canGoBack()) history.goBack();
      if (command.action === "forward" && history.canGoForward())
        history.goForward();
      if (command.action === "reload") view.webContents.reload();
    }
  };
  ipcMain.on("amun-browser", handle);
  window.on("resize", layout);
  window.once("closed", () => {
    ipcMain.removeListener("amun-browser", handle);
    browserSession.removeListener("will-download", denyDownload);
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
    view = undefined;
  });
}
