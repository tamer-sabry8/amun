import { execFile } from "node:child_process";
import { authBrowserUrl } from "../../../packages/auth/src/pi-auth.ts";
import { installBrowser } from "./browser.js";
import {
  app,
  BrowserWindow,
  session,
  utilityProcess,
  MessageChannelMain,
  type UtilityProcess,
} from "electron";
import { join } from "node:path";
import { windowPreferences, contentSecurityPolicy } from "./security.js";
import { restartDelay } from "../../service/src/health.js";

let service: UtilityProcess | undefined;
let quitting = false;
let attempt = 0;
let restartTimer: ReturnType<typeof setTimeout> | undefined;
let stableTimer: ReturnType<typeof setTimeout> | undefined;
const loadedWindows = new Set<BrowserWindow>();

function attach(window: BrowserWindow): void {
  if (!service || window.isDestroyed()) return;
  const { port1, port2 } = new MessageChannelMain();
  service.postMessage({ kind: "attach" }, [port1]);
  window.webContents.postMessage("amun-port", null, [port2]);
}
function startService(): void {
  if (quitting) return;
  const child = utilityProcess.fork(
    join(app.getAppPath(), "dist/service.cjs"),
    [],
    {
      serviceName: "Amun Service",
      env: {
        ...process.env,
        AMUN_AUTH_ROOT: join(app.getPath("userData"), "pi-agent"),
        AMUN_AUTH_WORKER: join(app.getAppPath(), "dist/auth-worker.cjs"),
        AMUN_AUTH_MODULE: app.isPackaged
          ? join(process.resourcesPath, "auth/node_modules/@napi-rs/keyring")
          : join(
              app.getAppPath(),
              "../../runtime/auth/node_modules/@napi-rs/keyring",
            ),
        AMUN_WORKSPACE_ROOT: join(app.getPath("userData"), "workspace"),
        AMUN_DATABASE_MODULE: app.isPackaged
          ? join(process.resourcesPath, "database/node_modules/better-sqlite3")
          : join(
              app.getAppPath(),
              ".runtime/database/node_modules/better-sqlite3",
            ),
        AMUN_CREW_RECEIPTS: join(app.getPath("userData"), "crew", "receipts"),
        AMUN_TMUX_BINARY:
          process.platform === "darwin"
            ? "/opt/homebrew/bin/tmux"
            : "/usr/bin/tmux",
        AMUN_PI_BINARY: process.execPath,
        AMUN_PI_ENTRY: app.isPackaged
          ? join(
              process.resourcesPath,
              "pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
            )
          : join(
              app.getAppPath(),
              "../../runtime/pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
            ),
        AMUN_TERMINAL_MODULE: app.isPackaged
          ? join(process.resourcesPath, "terminal/node_modules/node-pty")
          : join(
              app.getAppPath(),
              "../../runtime/terminal/node_modules/node-pty",
            ),
      },
    },
  );
  service = child;
  child.on("message", (message: unknown) => {
    if (
      !message ||
      typeof message !== "object" ||
      !("kind" in message) ||
      message.kind !== "auth-browser" ||
      !("provider" in message) ||
      typeof message.provider !== "string" ||
      !("url" in message) ||
      typeof message.url !== "string"
    )
      return;
    try {
      const url = authBrowserUrl(message.provider, message.url);
      execFile(
        "/usr/bin/open",
        ["-a", "Google Chrome", url],
        { timeout: 10000 },
        () => {},
      );
    } catch {
      /* Refuse unsupported destinations. */
    }
  });
  child.on("spawn", () => {
    for (const window of loadedWindows) attach(window);
    stableTimer = setTimeout(() => {
      attempt = 0;
    }, 10000);
  });
  child.once("exit", () => {
    clearTimeout(stableTimer);
    if (service !== child) return;
    service = undefined;
    if (quitting) return;
    for (const window of loadedWindows) {
      if (!window.isDestroyed())
        window.webContents.send("amun-status", "reconnecting");
    }
    restartTimer = setTimeout(startService, restartDelay(attempt++));
  });
}
function openWindow(): void {
  const window = new BrowserWindow({
    title: "Amun",
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      ...windowPreferences,
      preload: join(app.getAppPath(), "dist/preload.cjs"),
    },
  });
  installBrowser(window, "m0");
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("did-finish-load", () => {
    loadedWindows.add(window);
    attach(window);
  });
  window.once("closed", () => loadedWindows.delete(window));
  window.once("ready-to-show", () => window.show());
  void window.loadFile(join(app.getAppPath(), "renderer/index.html"));
}
void app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [contentSecurityPolicy],
      },
    });
  });
  startService();
  openWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
  });
});
app.on("before-quit", () => {
  quitting = true;
  clearTimeout(restartTimer);
  clearTimeout(stableTimer);
  service?.kill();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
