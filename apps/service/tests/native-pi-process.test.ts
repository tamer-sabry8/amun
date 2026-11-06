import { it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mock.spawn }));
import { NativePiProcess } from "../src/native-pi-process.ts";
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("uses only the configured worker and correlates bounded projected replies", () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
    exitCode: null,
    signalCode: null,
  });
  mock.spawn.mockReturnValue(child);
  const send = vi.fn();
  const process = new NativePiProcess(
    {
      binary: "/amun",
      worker: "/worker",
      entry: "/pi/dist/bundle/rpc-entry.js",
      root: "/private/pi",
    },
    send,
  );
  process.handle({ version: 1, kind: "native-pi", action: "eval" });
  expect(mock.spawn).not.toHaveBeenCalled();
  process.handle({
    version: 1,
    kind: "native-pi",
    action: "run",
    id: "a",
    command: "session",
    argument: "",
  });
  expect(mock.spawn).toHaveBeenCalledOnce();
  expect(mock.spawn.mock.calls[0]?.[2].env).not.toHaveProperty(
    "OPENAI_API_KEY",
  );
  process.handle({
    version: 1,
    kind: "native-pi",
    action: "run",
    id: "b",
    command: "session",
    argument: "",
  });
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ id: "b" }));
  child.stdout.emit(
    "data",
    JSON.stringify({
      version: 1,
      kind: "native-pi-result",
      id: "a",
      result: { kind: "message", text: "Ready" },
    }) + "\n",
  );
  expect(send).toHaveBeenLastCalledWith(
    expect.objectContaining({
      id: "a",
      result: { kind: "message", text: "Ready" },
    }),
  );
  process.close();
  expect(child.kill).toHaveBeenCalled();
  child.emit("exit");
  vi.clearAllTimers();
});
it("rejects malformed runtime records and terminates stalled operations", () => {
  vi.useFakeTimers();
  for (const malformed of [true, false]) {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
      exitCode: null,
      signalCode: null,
    });
    mock.spawn.mockReturnValue(child);
    const send = vi.fn();
    const process = new NativePiProcess(
      {
        binary: "/amun",
        worker: "/worker",
        entry: "/pi/dist/bundle/rpc-entry.js",
        root: "/private/pi",
      },
      send,
    );
    process.handle({
      version: 1,
      kind: "native-pi",
      action: "run",
      id: "a",
      command: "session",
      argument: "",
    });
    if (malformed) child.stdout.emit("data", '{"credentials":"CANARY"}\n');
    else vi.advanceTimersByTime(60000);
    expect(child.kill).toHaveBeenCalled();
    expect(JSON.stringify(send.mock.calls)).not.toContain("CANARY");
    child.emit("exit");
    vi.clearAllTimers();
  }
});
