import { it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({ on: vi.fn(), removeListener: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: mock }));
import { installWorkerLogin } from "../src/worker-login.ts";
it("accepts only shell-frame fixed CLI requests and suppresses overlapping launch operations", async () => {
  let release!: () => void;
  const launch = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const window = {
    webContents: { mainFrame: {}, send: vi.fn() },
    isDestroyed: () => false,
    once: vi.fn(),
  };
  installWorkerLogin(window as never, launch);
  const handler = mock.on.mock.calls[0]![1];
  const event = {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  };
  await handler({ ...event, senderFrame: {} }, { tool: "codex" });
  await handler(event, { tool: "codex", path: "/foreign" });
  expect(launch).not.toHaveBeenCalled();
  const first = handler(event, { tool: "codex" });
  await handler(event, { tool: "claude" });
  expect(launch).toHaveBeenCalledTimes(1);
  release();
  await first;
  expect(window.webContents.send).toHaveBeenLastCalledWith(
    "amun-worker-login-status",
    { tool: "codex", status: "opened" },
  );
  launch.mockRejectedValueOnce(Error("PRIVATE"));
  await handler(event, { tool: "claude" });
  expect(window.webContents.send).toHaveBeenLastCalledWith(
    "amun-worker-login-status",
    { tool: "claude", status: "failed" },
  );
});
