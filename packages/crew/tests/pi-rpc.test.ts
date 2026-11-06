import { afterEach, expect, it, vi } from "vitest";
import { PiRpcClient } from "../src/pi-rpc.js";
afterEach(() => vi.useRealTimers());
function fixture() {
  const writes: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const client = new PiRpcClient(
    (line) => writes.push(JSON.parse(line)),
    (frame) => events.push(frame),
  );
  const send = (frame: unknown) => client.receive(JSON.stringify(frame) + "\n");
  return { client, writes, events, send };
}
it("correlates out-of-order state/model replies without treating stream events as replies", async () => {
  const { client, writes, events, send } = fixture();
  const state = client.request("get_state");
  const models = client.request("get_available_models");
  send({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "hello\u2028world" },
  });
  send({
    type: "response",
    id: writes[1]?.id,
    command: "get_available_models",
    success: true,
    data: { models: [] },
  });
  send({
    type: "response",
    id: writes[0]?.id,
    command: "get_state",
    success: true,
    data: { isStreaming: false },
  });
  expect(await models).toEqual({ models: [] });
  expect(await state).toEqual({ isStreaming: false });
  expect(events).toHaveLength(1);
  client.close();
});
it("rejects mismatched reply commands", async () => {
  const { client, writes, send } = fixture();
  const pending = expect(client.request("get_state")).rejects.toThrow(
    "protocol",
  );
  send({
    type: "response",
    id: writes[0]?.id,
    command: "abort",
    success: true,
  });
  await pending;
});
it("times out without retrying a possibly executed prompt", async () => {
  vi.useFakeTimers();
  const { client, writes } = fixture();
  const pending = expect(
    client.request("prompt", { message: "hello" }, 20),
  ).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(20);
  await pending;
  expect(writes).toHaveLength(1);
  client.close();
});
it("rejects pending work on disconnect and refuses later commands", async () => {
  const { client } = fixture();
  const pending = expect(client.request("get_state")).rejects.toThrow("closed");
  client.close();
  await pending;
  await expect(client.request("get_state")).rejects.toThrow("closed");
});
it("does not include runtime failure text or malformed JSON in errors", async () => {
  const { client, writes, send } = fixture();
  const pending = expect(client.request("get_state")).rejects.toThrow(
    "Pi command failed",
  );
  send({
    type: "response",
    id: writes[0]?.id,
    command: "get_state",
    success: false,
    error: "SECRET-CANARY",
  });
  await pending;
  const next = expect(client.request("get_state")).rejects.toThrow(
    "Pi protocol failure",
  );
  client.receive("SECRET-CANARY\n");
  await next;
});
it("sends only explicit valid select/confirm answers, once", () => {
  const { client, writes, send, events } = fixture();
  send({
    type: "extension_ui_request",
    id: "choice",
    method: "select",
    title: "Pick",
    options: ["A", "B"],
  });
  send({
    type: "extension_ui_request",
    id: "confirm",
    method: "confirm",
    title: "Approve?",
    message: "Proceed?",
  });
  expect(writes).toEqual([]);
  expect(events).toHaveLength(2);
  expect(() => client.answer("choice", "C")).toThrow();
  expect(() => client.answer("confirm", "yes")).toThrow();
  client.answer("choice", "A");
  client.answer("confirm", false);
  expect(writes).toEqual([
    { type: "extension_ui_response", id: "choice", value: "A" },
    { type: "extension_ui_response", id: "confirm", confirmed: false },
  ]);
  expect(() => client.answer("choice", "A")).toThrow();
  client.close();
});
it("cancels unanswered extension dialogs on timeout", async () => {
  vi.useFakeTimers();
  const { client, writes, send } = fixture();
  send({
    type: "extension_ui_request",
    id: "expiry",
    method: "confirm",
    title: "Approve?",
    message: "Proceed?",
    timeout: 10,
  });
  await vi.advanceTimersByTimeAsync(10);
  expect(writes).toEqual([
    { type: "extension_ui_response", id: "expiry", cancelled: true },
  ]);
  expect(() => client.answer("expiry", true)).toThrow();
  client.close();
});
it("rejects payload attempts to replace command or correlation ID", async () => {
  const { client, writes } = fixture();
  await expect(client.request("get_state", { id: "forged" })).rejects.toThrow();
  await expect(
    client.request("get_state", { type: "prompt" }),
  ).rejects.toThrow();
  expect(writes).toEqual([]);
  client.close();
});
it("handles transport write failures without leaking their text", async () => {
  const client = new PiRpcClient(() => {
    throw new Error("SECRET-CANARY");
  });
  await expect(client.request("get_state")).rejects.toThrow(
    "Pi transport failure",
  );
  client.close();
});
it("bounds outstanding commands and clears them on disconnect", async () => {
  const { client, writes } = fixture();
  const pending = Array.from({ length: 64 }, () =>
    client.request("get_state").catch(() => "closed"),
  );
  await expect(client.request("get_state")).rejects.toThrow("excessive");
  expect(writes).toHaveLength(64);
  client.close();
  expect(await Promise.all(pending)).toEqual(Array(64).fill("closed"));
});
it("cancels unsupported interactive inputs without inventing an answer", () => {
  const { client, writes, send } = fixture();
  send({
    type: "extension_ui_request",
    id: "input",
    method: "input",
    title: "Secret",
  });
  expect(writes).toEqual([
    { type: "extension_ui_response", id: "input", cancelled: true },
  ]);
  client.close();
});
it("never emits a confirmation for malformed or duplicate dialogs", async () => {
  const { client, writes, send } = fixture();
  send({
    type: "extension_ui_request",
    id: "same",
    method: "confirm",
    title: "Approve?",
    message: "Proceed?",
  });
  send({
    type: "extension_ui_request",
    id: "same",
    method: "confirm",
    title: "Changed",
    message: "Proceed?",
  });
  expect(() => client.answer("same", true)).toThrow();
  expect(writes).toEqual([]);
  await expect(client.request("get_state")).rejects.toThrow("closed");
});
