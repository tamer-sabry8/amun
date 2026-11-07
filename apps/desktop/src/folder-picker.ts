import { BrowserWindow, dialog, ipcMain } from "electron";
import { listSelectedFolder } from "../../../packages/auth/src/filesystem-mcp.ts";

export function installFolderPicker(window: BrowserWindow, modules: string) {
  let busy = false;
  const handler = async (event: Electron.IpcMainEvent, id: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      typeof id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(id)
    )
      return;
    const send = (text: string) => {
      if (!window.isDestroyed())
        window.webContents.send("amun-folder-result", { id, text });
    };
    if (busy) return send("A folder selection is already open.");
    busy = true;
    try {
      const picked = await dialog.showOpenDialog(window, {
        title: "Choose a folder to list using read-only MCP",
        properties: ["openDirectory"],
        buttonLabel: "List this folder",
      });
      if (
        picked.canceled ||
        picked.filePaths.length !== 1 ||
        window.isDestroyed()
      )
        return send("Folder selection cancelled.");
      send(await listSelectedFolder(modules, picked.filePaths[0]!));
    } catch {
      send(
        "Folder listing unavailable. Choose an accessible folder inside a volume.",
      );
    } finally {
      busy = false;
    }
  };
  ipcMain.on("amun-choose-folder", handler);
  window.once("closed", () =>
    ipcMain.removeListener("amun-choose-folder", handler),
  );
}
