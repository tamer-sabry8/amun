import {
  BrowserWindow,
  WebContentsView,
  session,
  ipcMain,
  shell,
} from "electron";
import {
  browserCommand,
  browserPartition,
  browserLayout,
} from "./browser-policy.js";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { previewDecision, HandoffSlot } from "./preview-navigation.js";
import { windowPreferences } from "./security.js";

/** Isolated preview surface. Web pages receive neither preload nor service ports. */
export function installBrowser(window: BrowserWindow, product: string): void {
  const handoff = new HandoffSlot(Date.now, randomUUID);
  let handoffEpoch = 0;
  let entryURL: string | undefined;
  const clearHandoff = () => {
    handoffEpoch++;
    handoff.clear();
    if (!window.isDestroyed())
      window.webContents.send("amun-browser-handoff", null);
  };
  let view: WebContentsView | undefined;
  let partition = browserPartition(product);
  let browserSession = session.fromPartition(partition);
  const denyDownload = (event: Electron.Event) => event.preventDefault();
  const secureSession = () => {
    browserSession.setPermissionRequestHandler(
      (_contents, _permission, answer) => answer(false),
    );
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.setDevicePermissionHandler(() => false);
    browserSession.on("will-download", denyDownload);
  };
  secureSession();
  let viewport: ReturnType<typeof browserLayout> = null;
  const layout = () => {
    const [width = 0, height = 0] = window.getContentSize();
    if (viewport) {
      const valid = browserLayout(
        { action: "layout", ...viewport },
        width,
        height,
      );
      if (valid) {
        view?.setBounds(valid.bounds);
        if (
          view &&
          valid.zoom !== undefined &&
          Math.abs(view.webContents.getZoomFactor() - valid.zoom) > 0.005
        )
          view.webContents.setZoomFactor(valid.zoom);
        view?.setVisible(valid.visible);
      } else view?.setVisible(false);
    } else
      view?.setBounds({
        x: 0,
        y: 240,
        width,
        height: Math.max(0, height - 240),
      });
  };
  const close = () => {
    clearHandoff();
    entryURL = undefined;
    if (!view) return;
    window.contentView.removeChildView(view);
    view.webContents.close();
    view = undefined;
  };
  const notify = (message: string) => {
    if (!window.isDestroyed())
      window.webContents.send("amun-browser-status", message);
  };
  const guard = (url: string, main: boolean): boolean => {
    const decision = previewDecision(url, main);
    if (decision === "allow") return true;
    if (decision === "handoff") {
      // Restart in the external browser's own session, not an intercepted OAuth URL.
      const target =
        entryURL && previewDecision(entryURL, true) === "allow"
          ? entryURL
          : new URL(url).origin + "/";
      const id = handoff.offer(target);
      if (id)
        window.webContents.send("amun-browser-handoff", {
          id,
          host: new URL(target).host,
        });
      notify(
        "Federated sign-in requires an external browser. Restart sign-in there; it will not sign this panel in.",
      );
    }
    return false;
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
    contents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const supported =
        input.key === "Escape" ||
        (input.meta && input.key.toLowerCase() === "k") ||
        (input.meta && input.shift && input.key.toLowerCase() === "j") ||
        (input.meta && input.alt && /^Digit[1-5]$/.test(input.code));
      if (supported) {
        event.preventDefault();
        window.webContents.focus();
        window.webContents.send("amun-shell-shortcut", {
          key: input.key,
          code: input.code,
          metaKey: input.meta,
          altKey: input.alt,
          shiftKey: input.shift,
        });
      }
    });

    // Popups never gain an opener or a privileged window; redirect-based SSO is supported.
    contents.setWindowOpenHandler(({ url }) => {
      if (previewDecision(url, true) === "handoff") {
        guard(url, true);
        return { action: "deny" };
      }
      notify("Popup blocked. Use a sign-in flow that redirects in this view.");
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (!guard(url, true)) event.preventDefault();
    });
    contents.on("will-redirect", (event, url, _inPlace, isMainFrame) => {
      if (!guard(url, isMainFrame)) event.preventDefault();
    });
    contents.on("will-frame-navigate", (event) => {
      if (!guard(event.url, event.isMainFrame)) event.preventDefault();
    });
    contents.on("did-navigate", () => {
      clearHandoff();
      notify("Page loaded");
    });
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
    const [contentWidth = 0, contentHeight = 0] = window.getContentSize();
    const requestedLayout = browserLayout(input, contentWidth, contentHeight);
    if (requestedLayout) {
      viewport = requestedLayout;
      layout();
      return;
    }
    if (
      input &&
      typeof input === "object" &&
      Object.keys(input).length === 3 &&
      "action" in input &&
      input.action === "handoff" &&
      "id" in input &&
      "target" in input &&
      (input.target === "chrome" || input.target === "default")
    ) {
      const url = handoff.open(input.id);
      if (!url) {
        notify("External action expired or refused");
        return;
      }
      clearHandoff();
      const epoch = handoffEpoch;
      if (input.target === "default")
        void shell
          .openExternal(url)
          .catch(() => notify("External browser could not be opened"));
      else
        execFile("/usr/bin/open", ["-b", "com.google.Chrome", url], (error) => {
          if (error && !window.isDestroyed() && handoffEpoch === epoch) {
            const id = handoff.offer(url);
            window.webContents.send("amun-browser-handoff", {
              id,
              host: new URL(url).host,
            });
            notify("Chrome could not be opened. Try the default browser.");
          }
        });
      return;
    }
    const command = browserCommand(input);
    if (!command) {
      notify("Navigation refused");
      return;
    }
    if (command.action === "scope") {
      const next = browserPartition(
        createHash("sha256").update(command.product!).digest("hex"),
      );
      if (next !== partition) {
        close();
        browserSession.removeListener("will-download", denyDownload);
        partition = next;
        browserSession = session.fromPartition(partition);
        secureSession();
        notify("Preview closed for selected product");
      }
      return;
    }
    if (command.action === "close") {
      close();
      notify("Browser closed");
      return;
    }
    if (command.action === "navigate" && command.url) {
      clearHandoff();
      if (!guard(command.url, true)) return;
      entryURL = command.url;
      void ensure()
        .webContents.loadURL(command.url)
        .catch(() => notify("Page could not be loaded"));
    } else if (view) {
      clearHandoff();
      const history = view.webContents.navigationHistory;
      if (command.action === "back" && history.canGoBack()) {
        const target = history.getEntryAtIndex(history.getActiveIndex() - 1);
        if (target && guard(target.url, true)) history.goBack();
      }
      if (command.action === "forward" && history.canGoForward()) {
        const target = history.getEntryAtIndex(history.getActiveIndex() + 1);
        if (target && guard(target.url, true)) history.goForward();
      }
      if (command.action === "reload" && guard(view.webContents.getURL(), true))
        view.webContents.reload();
    }
  };
  ipcMain.on("amun-browser", handle);
  window.on("resize", layout);
  window.once("closed", () => {
    handoffEpoch++;
    handoff.clear();
    ipcMain.removeListener("amun-browser", handle);
    browserSession.removeListener("will-download", denyDownload);
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
    view = undefined;
  });
}
