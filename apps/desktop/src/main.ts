import { randomBytes } from "node:crypto";
import { installBackup } from "./backup-ui.ts";
import { execFile } from "node:child_process";
import { authBrowserArgs } from "./auth-browser.ts";
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
import { windowPreferences, shellSecurityPolicy } from "./security.js";
import { restartDelay } from "../../service/src/health.js";

const styleNonce = randomBytes(24).toString("base64url");
let service: UtilityProcess | undefined;
let quitting = false;
let attempt = 0;
let restartTimer: ReturnType<typeof setTimeout> | undefined;
let stableTimer: ReturnType<typeof setTimeout> | undefined;
const loadedWindows = new Set<BrowserWindow>();
const backupJobs = new Map<
  string,
  { done: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }
>();

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
      message &&
      typeof message === "object" &&
      "kind" in message &&
      message.kind === "backup-result" &&
      "id" in message &&
      typeof message.id === "string" &&
      "ok" in message &&
      typeof message.ok === "boolean"
    ) {
      const job = backupJobs.get(message.id);
      if (job) {
        clearTimeout(job.timer);
        backupJobs.delete(message.id);
        job.done(message.ok);
      }
      return;
    }

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
      const args = authBrowserArgs(
        message.provider,
        message.url,
        "selectedHost" in message && typeof message.selectedHost === "string"
          ? message.selectedHost
          : undefined,
      );
      execFile("/usr/bin/open", args, { timeout: 10000 }, () => {});
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
    for (const job of backupJobs.values()) {
      clearTimeout(job.timer);
      job.done(false);
    }
    backupJobs.clear();
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
  installBackup(
    window,
    (job) =>
      new Promise((resolve) => {
        if (!service) {
          resolve(false);
          return;
        }
        const timer = setTimeout(() => {
          backupJobs.delete(job.id);
          resolve(false);
        }, 120000);
        backupJobs.set(job.id, { done: resolve, timer });
        service.postMessage({ kind: "backup", ...job });
      }),
  );
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("did-finish-load", () => {
    loadedWindows.add(window);
    attach(window);
  });
  window.once("closed", () => loadedWindows.delete(window));
  window.once("ready-to-show", () => window.show());
  void window.loadFile(join(app.getAppPath(), "renderer/index.html"), {
    query: {
      styleNonce,
      ...(app.commandLine.hasSwitch("amun-proof")
        ? { proof: "1" }
        : !app.isPackaged && app.commandLine.hasSwitch("amun-gallery")
          ? { gallery: "1" }
          : {}),
    },
  });
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
        "Content-Security-Policy": [shellSecurityPolicy(styleNonce)],
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
