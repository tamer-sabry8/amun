import { it, expect, vi } from "vitest";
import { NativePiActions } from "../src/native-pi.ts";
function fixture() {
  const model = { provider: "github-copilot", id: "gpt-test", name: "Test" };
  const session = {
    isStreaming: false,
    sessionName: "",
    thinkingLevel: "medium",
    model,
    modelRuntime: { getAvailableSnapshot: () => [model] },
    cycleThinkingLevel: vi.fn(() => undefined as string | undefined),
    getAvailableThinkingLevels: () => ["off", "medium"],
    setThinkingLevel: vi.fn(),
    setModel: vi.fn(async () => {}),
    setSessionName: vi.fn(),
    getLastAssistantText: () => "response",
    getSessionStats: () => ({
      userMessages: 2,
      assistantMessages: 1,
      totalCost: 0.01,
      secret: "omit",
    }),
    compact: vi.fn(async () => ({ secret: "omit" })),
    reload: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  };
  return { session, actions: new NativePiActions(session) };
}
it("projects native model/thinking/session views without leaking runtime fields", async () => {
  const { actions } = fixture();
  expect(await actions.run("model", "")).toEqual({
    kind: "choices",
    title: "Select model",
    choices: [{ id: "github-copilot/gpt-test", label: "Test" }],
  });
  expect(await actions.run("thinking", "")).toEqual({
    kind: "choices",
    title: "Thinking level",
    choices: [
      { id: "off", label: "off" },
      { id: "medium", label: "medium" },
    ],
  });
  expect(JSON.stringify(await actions.run("session", ""))).not.toContain(
    "secret",
  );
});
it("executes valid SDK mutations and rejects unsupported models, levels, oversized names and busy mutation", async () => {
  const { session, actions } = fixture();
  await actions.run("model", "github-copilot/gpt-test");
  expect(session.setModel).toHaveBeenCalledWith(session.model);
  await actions.run("thinking", "off");
  expect(session.setThinkingLevel).toHaveBeenCalledWith("off");
  await actions.run("name", "Amun test");
  expect(session.setSessionName).toHaveBeenCalledWith("Amun test");
  await actions.run("compact", "keep decisions");
  expect(session.compact).toHaveBeenCalledWith("keep decisions");
  await actions.run("reload", "");
  expect(session.reload).toHaveBeenCalled();
  expect(await actions.run("copy", "")).toEqual({
    kind: "copy",
    text: "response",
  });
  for (const [command, arg] of [
    ["model", "bad"],
    ["thinking", "max"],
    ["name", "x".repeat(257)],
    ["unknown", ""],
  ])
    await expect(actions.run(command!, arg!)).rejects.toThrow();
  session.isStreaming = true;
  await expect(
    actions.run("model", "github-copilot/gpt-test"),
  ).rejects.toThrow();
});
it("cycles the active model's SDK thinking levels and reports an unsupported model without mutation", async () => {
  const { session, actions } = fixture();
  const cycle = vi
    .fn()
    .mockReturnValueOnce("medium")
    .mockReturnValueOnce(undefined);
  Object.assign(session, { cycleThinkingLevel: cycle });
  expect(await actions.run("cycle-thinking", "")).toEqual({
    kind: "message",
    text: "Thinking level: medium",
  });
  expect(await actions.run("cycle-thinking", "")).toEqual({
    kind: "message",
    text: "This model has no thinking levels to cycle.",
  });
  await expect(actions.run("cycle-thinking", "invalid")).rejects.toThrow();
  session.isStreaming = true;
  await expect(actions.run("cycle-thinking", "")).rejects.toThrow();
  expect(cycle).toHaveBeenCalledTimes(2);
});
