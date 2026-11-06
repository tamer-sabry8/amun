import { it, expect, vi } from "vitest";
import { TerminalSession } from "../src/terminal.ts";
function setup() {
  const pty = {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
  };
  const spawn = vi.fn(() => pty);
  const send = vi.fn();
  return { pty, spawn, send, session: new TerminalSession(spawn, send) };
}
const command = (action: string, extra: Record<string, unknown> = {}) => ({
  version: 1,
  kind: "terminal",
  action,
  ...extra,
});
it("opens at most one read-only terminal and requires explicit control for input", () => {
  const { session, pty, spawn, send } = setup();
  session.handle(command("open"));
  session.handle(command("open"));
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith({
    version: 1,
    kind: "terminal-state",
    state: "readonly",
  });
  session.handle(command("input", { data: "echo unsafe\r" }));
  expect(pty.write).not.toHaveBeenCalled();
  session.handle(command("take-control"));
  session.handle(command("input", { data: "echo ok\r" }));
  expect(pty.write).toHaveBeenCalledWith("echo ok\r");
  session.handle(command("release-control"));
  session.handle(command("input", { data: "no" }));
  expect(pty.write).toHaveBeenCalledTimes(1);
});
it("rejects invalid sizes, extra fields and excessive input before PTY operations", () => {
  const { session, pty, spawn } = setup();
  session.handle(command("open", { command: "rm" }));
  expect(spawn).not.toHaveBeenCalled();
  session.handle(command("open"));
  session.handle(command("resize", { cols: 100, rows: 30 }));
  expect(pty.resize).toHaveBeenCalledWith(100, 30);
  for (const cols of [0, -1, 501, 1.5])
    session.handle(command("resize", { cols, rows: 30 }));
  expect(pty.resize).toHaveBeenCalledTimes(1);
  session.handle(command("take-control"));
  session.handle(command("input", { data: "x".repeat(4097) }));
  expect(pty.write).not.toHaveBeenCalled();
});
it("cleans up only its PTY and fails safely on spawn errors", () => {
  const { session, pty } = setup();
  session.handle(command("open"));
  session.close();
  session.close();
  expect(pty.kill).toHaveBeenCalledTimes(1);
  const send = vi.fn();
  new TerminalSession(() => {
    throw new Error("secret-canary");
  }, send).handle(command("open"));
  expect(send).toHaveBeenCalledWith({
    version: 1,
    kind: "terminal-state",
    state: "unavailable",
  });
});

it("bounds terminal output instead of queueing an unlimited flood", () => {
  const { session, pty, send } = setup();
  session.handle(command("open"));
  const output = pty.onData.mock.calls[0]?.[0] as
    ((value: string) => void) | undefined;
  expect(output).toBeTypeOf("function");
  output!("x".repeat(1048577));
  expect(pty.kill).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenLastCalledWith({
    version: 1,
    kind: "terminal-state",
    state: "unavailable",
  });
});
