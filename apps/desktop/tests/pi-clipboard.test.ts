import { it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({
  on: vi.fn(),
  removeListener: vi.fn(),
  writeText: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcMain: { on: mock.on, removeListener: mock.removeListener },
  clipboard: { writeText: mock.writeText },
}));
import { installPiClipboard } from "../src/pi-clipboard.ts";
it("rejects foreign contents and subframes, acknowledges only bounded copies, and removes its handler", () => {
  const window = {
    webContents: { mainFrame: {}, send: vi.fn() },
    isDestroyed: () => false,
    once: vi.fn(),
  };
  installPiClipboard(window as never);
  const handler = mock.on.mock.calls[0]![1];
  const request = { action: "copy", id: "copy1", text: "reply" };
  handler({ sender: {}, senderFrame: window.webContents.mainFrame }, request);
  handler({ sender: window.webContents, senderFrame: {} }, request);
  expect(mock.writeText).not.toHaveBeenCalled();
  handler(
    { sender: window.webContents, senderFrame: window.webContents.mainFrame },
    request,
  );
  expect(mock.writeText).toHaveBeenCalledExactlyOnceWith("reply");
  expect(window.webContents.send).toHaveBeenCalledWith(
    "amun-pi-clipboard-status",
    { id: "copy1", ok: true },
  );
  window.once.mock.calls[0]![1]();
  expect(mock.removeListener).toHaveBeenCalledWith(
    "amun-pi-clipboard",
    handler,
  );
});
