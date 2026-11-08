import { BrowserWindow, clipboard, ipcMain } from "electron";
import { clipboardRequest } from "./pi-clipboard-policy.ts";
export function installPiClipboard(window: BrowserWindow) {
  const handler = (event: Electron.IpcMainEvent, input: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      return;
    const request = clipboardRequest(input);
    if (!request) return;
    let ok = false;
    try {
      clipboard.writeText(request.text);
      ok = true;
    } catch {
      /* no runtime details */
    }
    if (!window.isDestroyed())
      window.webContents.send("amun-pi-clipboard-status", {
        id: request.id,
        ok,
      });
  };
  ipcMain.on("amun-pi-clipboard", handler);
  window.once("closed", () =>
    ipcMain.removeListener("amun-pi-clipboard", handler),
  );
}
