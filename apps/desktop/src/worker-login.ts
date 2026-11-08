import { BrowserWindow, ipcMain } from "electron";
import { mkdtemp, writeFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  workerLoginRequest,
  workerLoginScript,
} from "../../../packages/crew/src/worker-login-launch.ts";
async function launchLogin(tool: "codex" | "claude") {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "amun-worker-login-")),
  );
  const path = join(root, "Sign in.command");
  try {
    await writeFile(
      path,
      workerLoginScript(
        process.execPath,
        join(__dirname, "worker-login-helper.cjs"),
        tool,
      ),
      { flag: "wx", mode: 0o700 },
    );
    await promisify(execFile)("/usr/bin/open", ["-a", "Terminal", path], {
      timeout: 10000,
    });
    // Terminal reads this asynchronously; retain this credential-free temporary launcher.
  } catch {
    await rm(root, { recursive: true, force: true });
    throw Error("Login could not open");
  }
}
export function installWorkerLogin(
  window: BrowserWindow,
  launch = launchLogin,
) {
  let busy = false;
  const handler = async (event: Electron.IpcMainEvent, input: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      busy
    )
      return;
    const tool = workerLoginRequest(input);
    if (!tool) return;
    busy = true;
    let status: "opened" | "failed" = "failed";
    try {
      await launch(tool);
      status = "opened";
    } catch {
      /* no credential-bearing runtime errors */
    } finally {
      busy = false;
      if (!window.isDestroyed())
        window.webContents.send("amun-worker-login-status", { tool, status });
    }
  };
  ipcMain.on("amun-worker-login", handler);
  window.once("closed", () =>
    ipcMain.removeListener("amun-worker-login", handler),
  );
}
