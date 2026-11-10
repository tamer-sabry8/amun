import { it, expect, vi } from "vitest";
it("clears stale errors and device codes on success or a fresh attempt but retains current failure feedback", async () => {
  vi.useFakeTimers();
  let receive: (event: unknown) => void = () => {};
  const fakeWindow = {
    addEventListener: (_: string, fn: typeof receive) => {
      receive = fn;
    },
  };
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", new EventTarget());
  const { bridge, initializeBridge } = await import("../src/bridge.ts");
  initializeBridge();
  const port = {
    onmessage: undefined as unknown as (event: unknown) => void,
    start() {},
    postMessage() {},
  };
  receive({ source: fakeWindow, data: { kind: "amun-port" }, ports: [port] });
  const send = (data: unknown) => port.onmessage({ data });
  send({ version: 1, kind: "auth-notice", message: "old error" });
  send({
    version: 1,
    kind: "auth-status",
    id: "github-copilot",
    status: "configured",
  });
  expect(bridge.getSnapshot().notice).toBe("");
  send({ version: 1, kind: "auth-notice", message: "failure" });
  send({
    version: 1,
    kind: "auth-status",
    id: "github-copilot",
    status: "error",
  });
  expect(bridge.getSnapshot().notice).toBe("failure");
  send({
    version: 1,
    kind: "auth-status",
    id: "github-copilot",
    status: "checking",
  });
  expect(bridge.getSnapshot().notice).toBe("");
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
