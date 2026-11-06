import { it, expect, vi } from "vitest";
import { PiSession } from "../src/pi-session.ts";
function setup() {
  const write = vi.fn();
  const send = vi.fn();
  const stop = vi.fn();
  const session = new PiSession(write, send, stop);
  return { write, send, stop, session };
}
it("projects text only and never forwards raw runtime fields", () => {
  const { session, send } = setup();
  session.receive(
    JSON.stringify({
      type: "message_update",
      secret: "canary",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "hello",
        credentials: "canary",
      },
    }) + "\n",
  );
  expect(send).toHaveBeenLastCalledWith({
    version: 1,
    kind: "pi-text",
    text: "hello",
  });
  session.receive(JSON.stringify({ type: "unknown", token: "canary" }) + "\n");
  expect(JSON.stringify(send.mock.calls)).not.toContain("canary");
  session.close();
});
it("projects bounded select/confirm dialogs and validates answers against pending requests", async () => {
  const { session, write, send } = setup();
  session.receive(
    JSON.stringify({
      type: "extension_ui_request",
      id: "select-1",
      method: "select",
      title: "Choose",
      options: ["one", "two"],
      secret: "canary",
    }) + "\n",
  );
  expect(send).toHaveBeenLastCalledWith({
    version: 1,
    kind: "pi-dialog",
    id: "select-1",
    method: "select",
    title: "Choose",
    options: ["one", "two"],
  });
  await session.handle({
    version: 1,
    kind: "pi",
    action: "answer",
    id: "select-1",
    answer: "invalid",
  });
  expect(write).not.toHaveBeenCalled();
  await session.handle({
    version: 1,
    kind: "pi",
    action: "answer",
    id: "select-1",
    answer: "two",
  });
  expect(JSON.parse(write.mock.calls[0]![0])).toEqual({
    type: "extension_ui_response",
    id: "select-1",
    value: "two",
  });
  session.receive(
    JSON.stringify({
      type: "extension_ui_request",
      id: "confirm-1",
      method: "confirm",
      title: "Confirm",
      message: "Continue?",
    }) + "\n",
  );
  await session.handle({
    version: 1,
    kind: "pi",
    action: "answer",
    id: "confirm-1",
    answer: false,
  });
  expect(JSON.parse(write.mock.calls[1]![0])).toEqual({
    type: "extension_ui_response",
    id: "confirm-1",
    confirmed: false,
  });
  session.close();
});
it("cancels unrenderable dialogs and closes on output overflow", () => {
  const { session, write, send, stop } = setup();
  session.receive(
    JSON.stringify({
      type: "extension_ui_request",
      id: "large",
      method: "select",
      title: "x".repeat(4097),
      options: ["one"],
    }) + "\n",
  );
  expect(JSON.parse(write.mock.calls[0]![0])).toEqual({
    type: "extension_ui_response",
    id: "large",
    cancelled: true,
  });
  for (let i = 0; i < 5; i++)
    session.receive(
      JSON.stringify({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "x".repeat(65536) },
      }) + "\n",
    );
  expect(stop).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenLastCalledWith({
    version: 1,
    kind: "pi-state",
    state: "unavailable",
  });
});
it("does not treat command acknowledgement as completed inference", async () => {
  const { session, write, send } = setup();
  const pending = session.handle({
    version: 1,
    kind: "pi",
    action: "prompt",
    message: "Hello",
  });
  const request = JSON.parse(write.mock.calls[0]![0]);
  session.receive(
    JSON.stringify({
      type: "response",
      id: request.id,
      command: "prompt",
      success: true,
    }) + "\n",
  );
  await pending;
  expect(send.mock.calls.some(([e]) => e.state === "complete")).toBe(false);
  session.close();
});
it("rejects extra fields and sends only generic errors for transport failure", async () => {
  const { session, write } = setup();
  await session.handle({
    version: 1,
    kind: "pi",
    action: "prompt",
    message: "Hi",
    auth: "secret",
  });
  expect(write).not.toHaveBeenCalled();
  session.close();
});

it("closes and reports unavailable when a prompt transport fails, without raw error details", async () => {
  const send = vi.fn();
  const stop = vi.fn();
  const session = new PiSession(
    () => {
      throw new Error("secret-canary");
    },
    send,
    stop,
  );
  await session.handle({
    version: 1,
    kind: "pi",
    action: "prompt",
    message: "Hello",
  });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenLastCalledWith({
    version: 1,
    kind: "pi-state",
    state: "unavailable",
  });
  expect(JSON.stringify(send.mock.calls)).not.toContain("secret-canary");
});
