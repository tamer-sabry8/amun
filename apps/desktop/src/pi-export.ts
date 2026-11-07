import { BrowserWindow, dialog, ipcMain } from "electron";
import { writeFile } from "node:fs/promises";
import { exportRequest } from "./pi-export-policy.ts";
export function installPiExport(window: BrowserWindow) {
  let busy = false;
  const handler = async (event: Electron.IpcMainEvent, input: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      busy
    )
      return;
    const request = exportRequest(input);
    if (!request) return;
    busy = true;
    let status: "saved" | "cancelled" | "failed" = "failed";
    try {
      const chosen = await dialog.showSaveDialog(window, {
        title: "Save reviewed Pi session",
        defaultPath: "Amun-session." + request.format,
        filters: [
          { name: request.format.toUpperCase(), extensions: [request.format] },
        ],
      });
      if (chosen.canceled || !chosen.filePath) status = "cancelled";
      else {
        await writeFile(chosen.filePath, request.text, {
          flag: "wx",
          mode: 0o600,
        });
        status = "saved";
      }
    } catch {
      /* Sanitized failure; never overwrite or retry another path. */
    } finally {
      busy = false;
      if (!window.isDestroyed())
        window.webContents.send("amun-pi-export-status", {
          id: request.id,
          status,
        });
    }
  };
  ipcMain.on("amun-pi-export", handler);
  window.once("closed", () =>
    ipcMain.removeListener("amun-pi-export", handler),
  );
}
