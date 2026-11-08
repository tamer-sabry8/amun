import { BrowserWindow, dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { backupRequest } from "./backup-policy.ts";
export function installBackup(
  window: BrowserWindow,
  run: (job: {
    id: string;
    action: "export" | "restore";
    password: string;
    archive: string;
    target: string;
  }) => Promise<boolean>,
): void {
  let busy = false;
  const notify = (message: string) => {
    if (!window.isDestroyed())
      window.webContents.send("amun-backup-status", message);
  };
  const handler = async (event: Electron.IpcMainEvent, input: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      busy
    )
      return;
    const request = backupRequest(input);
    if (!request) return;
    busy = true;
    try {
      let archive = "",
        target = "";
      if (request.action === "export") {
        const chosen = await dialog.showSaveDialog(window, {
          title: "Export encrypted workspace",
          defaultPath: "Amun-workspace.amunbackup",
          filters: [
            { name: "Encrypted Amun backup", extensions: ["amunbackup"] },
          ],
          properties: ["showOverwriteConfirmation"],
        });
        if (chosen.canceled || !chosen.filePath) {
          notify("Backup cancelled");
          return;
        }
        archive = chosen.filePath;
      } else {
        const chosen = await dialog.showOpenDialog(window, {
          title: "Choose encrypted workspace backup",
          properties: ["openFile"],
          filters: [
            { name: "Encrypted Amun backup", extensions: ["amunbackup"] },
          ],
        });
        if (chosen.canceled || !chosen.filePaths[0]) {
          notify("Restore cancelled");
          return;
        }
        archive = chosen.filePaths[0];
        const destination = await dialog.showSaveDialog(window, {
          title: "Choose a new workspace folder name",
          defaultPath: "Amun-restored-workspace",
          buttonLabel: "Restore to new folder",
        });
        if (destination.canceled || !destination.filePath) {
          notify("Restore cancelled");
          return;
        }
        target = destination.filePath;
      }
      notify("Working…");
      const ok = await run({ id: randomUUID(), ...request, archive, target });
      notify(
        ok
          ? request.action === "export"
            ? "Encrypted backup exported."
            : "Workspace restored to the new folder. Your current workspace is unchanged."
          : "Backup operation failed. Check the passphrase and choose a new destination; existing files are never overwritten.",
      );
    } catch {
      notify("Backup operation could not be completed.");
    } finally {
      request.password = "";
      busy = false;
    }
  };
  ipcMain.on("amun-backup", handler);
  window.once("closed", () => ipcMain.removeListener("amun-backup", handler));
}
