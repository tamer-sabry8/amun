import { it, expect, vi, beforeEach } from "vitest";
const state = vi.hoisted(() => ({
  ipc: new Map<string, (...args: unknown[]) => void>(),
  sessions: [] as unknown[],
  preferences: [] as Record<string, unknown>[],
  views: [] as unknown[],
  open: vi.fn(async () => {}),
  events: new Map<string, (...args: unknown[]) => void>(),
  sent: [] as unknown[][],
  launch: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execFile: state.launch }));
vi.mock("electron", () => ({
  ipcMain: {
    on: (key: string, fn: (...args: unknown[]) => void) =>
      state.ipc.set(key, fn),
    removeListener: (key: string) => state.ipc.delete(key),
  },
  shell: { openExternal: state.open },
  session: {
    fromPartition: vi.fn(() => {
      const s = {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
        setDevicePermissionHandler: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
      };
      state.sessions.push(s);
      return s;
    }),
  },
  WebContentsView: class {
    webContents = {
      on: (key: string, fn: (...args: unknown[]) => void) =>
        state.events.set(key, fn),
      setWindowOpenHandler: vi.fn(),
      loadURL: vi.fn(async () => {}),
      close: vi.fn(),
      isDestroyed: () => false,
      getURL: () => "https://example.com/",
      navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    };
    constructor(options: { webPreferences: Record<string, unknown> }) {
      state.preferences.push(options.webPreferences);
      state.views.push(this);
    }
    setBounds = vi.fn();
    setVisible = vi.fn();
  },
}));
import { installBrowser } from "../src/browser.ts";
import type { BrowserWindow } from "electron";
beforeEach(() => {
  state.ipc.clear();
  state.sessions = [];
  state.preferences = [];
  state.views = [];
  state.events.clear();
  state.sent = [];
  state.open.mockReset();
  state.launch.mockReset();
});
function fixture() {
  const frame = {};
  const wc = {
    focus: vi.fn(),
    mainFrame: frame,
    send: (...args: unknown[]) => state.sent.push(args),
  };
  const hooks = new Map<string, () => void>();
  const window = {
    webContents: wc,
    isDestroyed: () => false,
    getContentSize: () => [800, 600],
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    on: (key: string, fn: () => void) => hooks.set(key, fn),
    once: (key: string, fn: () => void) => hooks.set(key, fn),
  };
  installBrowser(window as unknown as BrowserWindow, "m0");
  const send = (
    command: unknown,
    sender: unknown = wc,
    senderFrame: unknown = frame,
  ) => state.ipc.get("amun-browser")!({ sender, senderFrame }, command);
  return { send, hooks };
}
it("preserves hardened view and denies permission requests without a preview preload", () => {
  const { send, hooks } = fixture();
  send({ action: "navigate", url: "https://example.com" });
  expect(state.preferences[0]).toMatchObject({
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    webviewTag: false,
    partition: "persist:amun-browser-m0",
  });
  expect(state.preferences[0]).not.toHaveProperty("preload");
  hooks.get("closed")!();
  expect(state.ipc.has("amun-browser")).toBe(false);
});
it("never opens from page IPC, raw URLs, unknown IDs or navigation alone", async () => {
  const { send } = fixture();
  send({ action: "navigate", url: "https://accounts.google.com" }, {});
  expect(state.sent).toEqual([]);
  send({ action: "navigate", url: "https://accounts.google.com" });
  expect(state.views).toHaveLength(0);
  expect(state.open).not.toHaveBeenCalled();
  send({ action: "handoff", id: "unknown", target: "default" });
  send({
    action: "handoff",
    id: "x",
    target: "default",
    url: "https://evil.test",
  });
  expect(state.open).not.toHaveBeenCalled();
  const message = state.sent.find(
    (x) => x[0] === "amun-browser-handoff" && x[1],
  );
  const data = message![1] as { id: string };
  send({ action: "handoff", id: data.id, target: "default" });
  await Promise.resolve();
  expect(state.open).toHaveBeenCalledWith("https://accounts.google.com/");
  send({ action: "handoff", id: data.id, target: "default" });
  expect(state.open).toHaveBeenCalledTimes(1);
});
it("blocks subframe IdP redirects without a handoff and cancels forbidden schemes", () => {
  const { send } = fixture();
  send({ action: "navigate", url: "https://example.com" });
  state.sent = [];
  const preventDefault = vi.fn();
  state.events.get("will-redirect")!(
    { preventDefault },
    "https://accounts.google.com",
    false,
    false,
  );
  expect(preventDefault).toHaveBeenCalledTimes(1);
  expect(state.sent).toEqual([]);
  state.events.get("will-frame-navigate")!({
    url: "file:///etc/passwd",
    isMainFrame: true,
    preventDefault,
  });
  expect(preventDefault).toHaveBeenCalledTimes(2);
});

it("opens Chrome with exact argv and ignores a late failure after navigation", () => {
  const { send } = fixture();
  send({ action: "navigate", url: "https://accounts.google.com" });
  const data = state.sent.find(
    (x) => x[0] === "amun-browser-handoff" && x[1],
  )![1] as { id: string };
  send({ action: "handoff", id: data.id, target: "chrome" });
  expect(state.launch).toHaveBeenCalledWith(
    "/usr/bin/open",
    ["-b", "com.google.Chrome", "https://accounts.google.com/"],
    expect.any(Function),
  );
  const callback = state.launch.mock.calls[0]![2] as (error: Error) => void;
  send({ action: "navigate", url: "https://example.com/new" });
  state.sent = [];
  callback(new Error("not installed"));
  expect(state.sent).toEqual([]);
});

it("denies permissions/downloads and supports bounded lifecycle/status callbacks", async () => {
  const { send, hooks } = fixture();
  send({ action: "close" });
  send({ action: "back" });
  send({ action: "navigate", url: "https://example.com" });
  send({ action: "navigate", url: "https://example.com/again" });
  hooks.get("resize")!();
  const ses = state.sessions[0] as {
    setPermissionRequestHandler: ReturnType<typeof vi.fn>;
    setPermissionCheckHandler: ReturnType<typeof vi.fn>;
    setDevicePermissionHandler: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };
  const answer = vi.fn();
  ses.setPermissionRequestHandler.mock.calls[0]![0](null, "media", answer);
  expect(answer).toHaveBeenCalledWith(false);
  expect(ses.setPermissionCheckHandler.mock.calls[0]![0]()).toBe(false);
  expect(ses.setDevicePermissionHandler.mock.calls[0]![0]()).toBe(false);
  const preventDefault = vi.fn();
  ses.on.mock.calls[0]![1]({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  const wc = (
    state.views[0] as {
      webContents: {
        setWindowOpenHandler: ReturnType<typeof vi.fn>;
        loadURL: ReturnType<typeof vi.fn>;
      };
    }
  ).webContents;
  expect(
    wc.setWindowOpenHandler.mock.calls[0]![0]({ url: "https://example.com" }),
  ).toEqual({ action: "deny" });
  expect(
    wc.setWindowOpenHandler.mock.calls[0]![0]({
      url: "https://accounts.google.com",
    }),
  ).toEqual({ action: "deny" });
  state.events.get("will-navigate")!({ preventDefault }, "https://example.com");
  state.events.get("will-navigate")!({ preventDefault }, "file:///x");
  state.events.get("did-navigate")!();
  state.events.get("did-fail-load")!({}, -2, "private", "private", true);
  state.events.get("did-fail-load")!({}, -3, "", "", true);
  state.events.get("did-fail-load")!({}, -2, "", "", false);
  wc.loadURL.mockRejectedValueOnce(new Error("private"));
  send({ action: "navigate", url: "https://example.com/fail" });
  await Promise.resolve();
  await Promise.resolve();
  expect(state.sent.some((x) => x[1] === "Page could not be loaded")).toBe(
    true,
  );
  send({ action: "close" });
  expect(state.sent.some((x) => x[1] === "Browser closed")).toBe(true);
  hooks.get("closed")!();
});
it("reports external failures without leaking exception details", async () => {
  const { send } = fixture();
  send({ action: "navigate", url: "https://accounts.google.com" });
  const getId = () =>
    [...state.sent]
      .reverse()
      .find((x) => x[0] === "amun-browser-handoff" && x[1])![1] as {
      id: string;
    };
  state.launch.mockImplementation((_bin, _args, callback) =>
    callback(new Error("private")),
  );
  send({ action: "handoff", id: getId().id, target: "chrome" });
  expect(
    state.sent.some(
      (x) => x[1] === "Chrome could not be opened. Try the default browser.",
    ),
  ).toBe(true);
  expect(JSON.stringify(state.sent)).not.toContain("private");
});

it("fits/hides the native view, discards old scope endpoints and forwards only shell shortcut keys", () => {
  const { send } = fixture();
  send({
    action: "layout",
    visible: false,
    bounds: { x: 400, y: 100, width: 300, height: 400 },
  });
  send({ action: "navigate", url: "https://example.com" });
  const first = state.views[0] as {
    setBounds: ReturnType<typeof vi.fn>;
    setVisible: ReturnType<typeof vi.fn>;
    webContents: { close: ReturnType<typeof vi.fn> };
  };
  expect(first.setBounds).toHaveBeenLastCalledWith({
    x: 400,
    y: 100,
    width: 300,
    height: 400,
  });
  expect(first.setVisible).toHaveBeenLastCalledWith(false);
  send({
    action: "layout",
    visible: true,
    bounds: { x: 400, y: 100, width: 300, height: 400 },
  });
  expect(first.setVisible).toHaveBeenLastCalledWith(true);
  const preventDefault = vi.fn();
  const key = state.events.get("before-input-event")!;
  key({ preventDefault }, { type: "keyUp", key: "Escape" });
  key({ preventDefault }, { type: "keyDown", key: "a", code: "KeyA" });
  expect(preventDefault).not.toHaveBeenCalled();
  key(
    { preventDefault },
    {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      meta: false,
      alt: false,
      shift: false,
    },
  );
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(state.sent.at(-1)).toEqual([
    "amun-shell-shortcut",
    {
      key: "Escape",
      code: "Escape",
      metaKey: false,
      altKey: false,
      shiftKey: false,
    },
  ]);
  send({ action: "scope", product: "other" });
  expect(first.webContents.close).toHaveBeenCalledOnce();
  send({ action: "navigate", url: "https://example.com" });
  expect(state.preferences[1]!.partition).not.toBe(
    state.preferences[0]!.partition,
  );
  send({ action: "scope", product: "other" });
  expect(state.sessions).toHaveLength(2);
});
