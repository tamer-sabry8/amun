import { it, expect } from "vitest";
import { nativePiCommand, nativePiEvent } from "../src/native-pi.ts";
it("bounds native requests and rejects injected operations and raw runtime results", () => {
  expect(
    nativePiCommand.safeParse({
      version: 1,
      kind: "native-pi",
      action: "run",
      id: "1",
      command: "model",
      argument: "",
    }).success,
  ).toBe(true);
  for (const request of [
    { version: 1, kind: "native-pi", action: "eval", code: "bad" },
    {
      version: 1,
      kind: "native-pi",
      action: "run",
      id: "1",
      command: "model",
      argument: "x".repeat(16385),
    },
  ])
    expect(nativePiCommand.safeParse(request).success).toBe(false);
  expect(
    nativePiEvent.safeParse({
      version: 1,
      kind: "native-pi-result",
      id: "1",
      result: { kind: "message", text: "Ready" },
    }).success,
  ).toBe(true);
  expect(
    nativePiEvent.safeParse({
      version: 1,
      kind: "native-pi-result",
      id: "1",
      result: { kind: "message", text: "Ready", credentials: "bad" },
    }).success,
  ).toBe(false);
});
it("accepts only a bounded exact Notion review and approval identity", () => {
  const result = {
    kind: "notion-review",
    reviewId: "11111111-1111-4111-8111-111111111111",
    binding: "a".repeat(64),
    title: "Conversation",
    text: "Reviewed text",
    destination: "Documents",
    destinationId: "22222222-2222-4222-8222-222222222222",
  };
  expect(
    nativePiEvent.safeParse({
      version: 1,
      kind: "native-pi-result",
      id: "review",
      result,
    }).success,
  ).toBe(true);
  expect(
    nativePiEvent.safeParse({
      version: 1,
      kind: "native-pi-result",
      id: "review",
      result: { ...result, access_token: "secret" },
    }).success,
  ).toBe(false);
  expect(
    nativePiEvent.safeParse({
      version: 1,
      kind: "native-pi-result",
      id: "review",
      result: { ...result, binding: "bad" },
    }).success,
  ).toBe(false);
});
