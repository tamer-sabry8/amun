import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserWindow, ipcMain } from "electron";

/** The largest capture handed back to the window. */
const limit = 24 * 1024 * 1024;

/**
 * Composer "Screenshot": starts the Mac's own area selection at once and
 * returns the captured image to the window that asked. Cancelling the
 * selection returns nothing, so the draft is left as it was.
 */
export function installScreenshot(window: BrowserWindow) {
  let busy = false;
  const handler = async (event: Electron.IpcMainEvent, id: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      typeof id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(id) ||
      busy
    )
      return;
    busy = true;
    const dir = await mkdtemp(join(tmpdir(), "amun-screenshot-"));
    const file = join(dir, "capture.png");
    let bytes: Uint8Array | null = null;
    try {
      // -i: interactive area selection · -x: no sound · never to clipboard.
      await new Promise<void>((resolve) =>
        execFile(
          "/usr/sbin/screencapture",
          ["-i", "-x", "-t", "png", file],
          { timeout: 300_000 },
          () => resolve(),
        ),
      );
      const data = await readFile(file).catch(() => null);
      if (data?.length && data.length <= limit) bytes = new Uint8Array(data);
    } finally {
      busy = false;
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (!window.isDestroyed())
      window.webContents.send("amun-screenshot-result", { id, bytes });
  };
  ipcMain.on("amun-screenshot", handler);
  window.once("closed", () =>
    ipcMain.removeListener("amun-screenshot", handler),
  );
}
