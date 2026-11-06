import { it, expect } from "vitest";
import {
  selectedCredential,
  InferenceEvidence,
  selectedCopilotCredential,
} from "../src/pi-inference.ts";
it("selects one supported credential without copying a credential store", () => {
  expect(
    selectedCredential(
      "openrouter",
      JSON.stringify({
        status: "ready",
        provider: "openrouter",
        credentials: "canary-key",
      }),
    ),
  ).toEqual({ name: "OPENROUTER_API_KEY", value: "canary-key" });
  expect(() =>
    selectedCredential(
      "github-copilot",
      JSON.stringify({
        status: "ready",
        provider: "github-copilot",
        credentials: "canary-key",
      }),
    ),
  ).toThrow("Provider credential unavailable");
});
it.each([
  "secret-canary",
  JSON.stringify({
    status: "ready",
    provider: "wrong",
    credentials: "secret-canary",
  }),
  JSON.stringify({ status: "not_ready", provider: "openrouter" }),
  JSON.stringify({ status: "ready", provider: "openrouter", credentials: "" }),
])("refuses mismatches without leaking source %s", (output) => {
  expect(() => selectedCredential("openrouter", output)).toThrow(
    "Provider credential unavailable",
  );
});
it("waits for successful assistant message and settled event, not prompt acknowledgement", () => {
  const run = new InferenceEvidence();
  run.accept({ type: "response", success: true });
  expect(run.complete).toBe(false);
  run.accept({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "AMUN_OK" },
  });
  run.accept({
    type: "message_end",
    message: { role: "assistant", stopReason: "stop" },
  });
  run.accept({ type: "agent_end" });
  expect(run.complete).toBe(false);
  run.accept({ type: "agent_settled", aborted: false });
  expect(run.complete).toBe(true);
  expect(run.text).toBe("AMUN_OK");
});
it("refuses aborted, failed, tool-bearing, and oversized runs", () => {
  for (const event of [
    { type: "agent_settled", aborted: true },
    { type: "tool_execution_start" },
    {
      type: "message_end",
      message: { role: "assistant", stopReason: "error" },
    },
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "x".repeat(262145) },
    },
  ]) {
    const run = new InferenceEvidence();
    run.accept(event);
    expect(run.failed).toBe(true);
    expect(run.complete).toBe(false);
  }
});

it("validates only selected Copilot OAuth fields without losing provider metadata", () => {
  const credential = {
    type: "oauth",
    access: "access-canary",
    refresh: "refresh-canary",
    expires: 1234,
    enterpriseUrl: "github.example.test",
    availableModelIds: ["gpt-4.1"],
  };
  expect(selectedCopilotCredential(credential)).toEqual(credential);
  for (const input of [
    null,
    { type: "api_key", key: "canary" },
    { ...credential, refresh: "" },
    { ...credential, expires: "bad" },
  ])
    expect(() => selectedCopilotCredential(input)).toThrow(
      "Selected Copilot OAuth unavailable",
    );
});
