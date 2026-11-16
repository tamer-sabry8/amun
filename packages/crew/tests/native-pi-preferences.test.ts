import { it, expect, vi } from "vitest";
import { NativePiPreferences } from "../src/native-pi-preferences.ts";
function fixture() {
  let enabled: string[] | undefined;
  const models = [
    { provider: "github-copilot", id: "one" },
    { provider: "github-copilot", id: "two" },
  ];
  const settings = {
    getEnabledModels: () => enabled,
    setEnabledModels: vi.fn((value: string[] | undefined) => {
      enabled = value;
    }),
    flush: vi.fn(async () => {}),
    drainErrors: (): unknown[] => [],
  };
  const session = {
    isStreaming: false,
    scopedModels: [] as { model: { provider: string; id: string } }[],
    setScopedModels: vi.fn(),
    cycleModel: vi.fn(async () => ({
      model: { provider: "github-copilot", id: "one" },
    })),
    modelRuntime: { getAvailableSnapshot: () => models },
    settingsManager: settings,
  };
  return { session, settings, actions: new NativePiPreferences(session) };
}
it("toggles only available models, persists through the SDK and refuses an empty scope", async () => {
  const { actions, session, settings } = fixture();
  expect(JSON.stringify(await actions.run("scoped-models", ""))).toContain(
    "Included",
  );
  await actions.run("scoped-models", "github-copilot/one");
  expect(settings.setEnabledModels).toHaveBeenCalledWith([
    "github-copilot/two",
  ]);
  expect(session.setScopedModels).toHaveBeenCalledWith([
    { model: { provider: "github-copilot", id: "two" } },
  ]);
  await expect(
    actions.run("scoped-models", "github-copilot/two"),
  ).rejects.toThrow();
  await expect(actions.run("scoped-models", "foreign/model")).rejects.toThrow();
  expect(settings.flush).toHaveBeenCalled();
});
it("refuses mutations while busy and does not report success after persistence errors", async () => {
  const { actions, session, settings } = fixture();
  session.isStreaming = true;
  await expect(
    actions.run("scoped-models", "github-copilot/one"),
  ).rejects.toThrow();
  session.isStreaming = false;
  settings.drainErrors = () => [{}];
  await expect(
    actions.run("scoped-models", "github-copilot/one"),
  ).rejects.toThrow();
});

it("restores the persisted scope before cycling and rejects invalid directions", async () => {
  const { actions, session } = fixture();
  await actions.run("scoped-models", "github-copilot/one");
  session.cycleModel = vi.fn(async () => ({
    model: { provider: "github-copilot", id: "two" },
  }));
  expect(await actions.cycle("forward")).toEqual({
    kind: "message",
    text: "Model selected: github-copilot/two",
  });
  expect(session.cycleModel).toHaveBeenCalledWith("forward");
  await expect(actions.cycle("bad")).rejects.toThrow();
});

it("never cycles or lists models from another provider", async () => {
  const { session, actions } = fixture();
  session.modelRuntime.getAvailableSnapshot = () => [
    { provider: "github-copilot", id: "one" },
    { provider: "openai", id: "other" },
  ];
  await actions.cycle("forward");
  expect(session.setScopedModels).toHaveBeenCalledWith([
    { model: { provider: "github-copilot", id: "one" } },
  ]);
  await expect(actions.run("scoped-models", "openai/other")).rejects.toThrow(
    "Model unavailable",
  );
});
