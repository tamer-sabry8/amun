import { it, expect, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const mock = vi.hoisted(() => ({
  on: vi.fn(),
  removeListener: vi.fn(),
  showSaveDialog: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: { on: mock.on, removeListener: mock.removeListener },
  dialog: { showSaveDialog: mock.showSaveDialog },
}));
import { installPiExport } from "../src/pi-export.ts";
it("requires the shell frame and chosen new file, refusing overwrite and respecting cancellation", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-export-save-"));
  const path = join(root, "new.jsonl");
  const window = {
    webContents: { mainFrame: {}, send: vi.fn() },
    isDestroyed: () => false,
    once: vi.fn(),
  };
  installPiExport(window as never);
  const handler = mock.on.mock.calls[0]![1];
  const event = {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  };
  const request = { id: "x", format: "jsonl", text: "reviewed" };
  try {
    await handler({ ...event, senderFrame: {} }, request);
    expect(mock.showSaveDialog).not.toHaveBeenCalled();
    mock.showSaveDialog.mockResolvedValue({ canceled: false, filePath: path });
    await handler(event, request);
    expect(await readFile(path, "utf8")).toBe("reviewed");
    expect(window.webContents.send).toHaveBeenLastCalledWith(
      "amun-pi-export-status",
      { id: "x", status: "saved" },
    );
    await writeFile(path, "existing");
    await handler(event, request);
    expect(await readFile(path, "utf8")).toBe("existing");
    expect(window.webContents.send).toHaveBeenLastCalledWith(
      "amun-pi-export-status",
      { id: "x", status: "failed" },
    );
    mock.showSaveDialog.mockResolvedValue({ canceled: true });
    await handler(event, request);
    expect(window.webContents.send).toHaveBeenLastCalledWith(
      "amun-pi-export-status",
      { id: "x", status: "cancelled" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
