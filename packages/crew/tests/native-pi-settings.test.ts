import { it, expect, vi } from "vitest";
import { NativePiSettings } from "../src/native-pi-settings.ts";
function fixture() {
  const session = {
    isStreaming: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    steeringMode: "one-at-a-time" as const,
    followUpMode: "one-at-a-time" as const,
    setAutoCompactionEnabled: vi.fn(),
    setAutoRetryEnabled: vi.fn(),
    setSteeringMode: vi.fn(),
    setFollowUpMode: vi.fn(),
    settingsManager: {
      getBlockImages: () => false,
      setBlockImages: vi.fn(),
      getEnableSkillCommands: () => true,
      setEnableSkillCommands: vi.fn(),
      flush: vi.fn(async () => {}),
      drainErrors: (): unknown[] => [],
    },
  };
  return { session, settings: new NativePiSettings(session) };
}
it("projects only supported settings and persists validated changes through SDK methods", async () => {
  const { session, settings } = fixture();
  const view = await settings.run("");
  expect(view.kind).toBe("preferences");
  await settings.run(JSON.stringify({ id: "compaction", value: "false" }));
  expect(session.setAutoCompactionEnabled).toHaveBeenCalledWith(false);
  await settings.run(JSON.stringify({ id: "steering", value: "all" }));
  expect(session.setSteeringMode).toHaveBeenCalledWith("all");
  expect(session.settingsManager.flush).toHaveBeenCalled();
});
it("refuses unknown keys, invalid values, extra fields, busy mutations and persistence failures", async () => {
  const { session, settings } = fixture();
  for (const input of [
    "{}",
    '{"id":"secret","value":"x"}',
    '{"id":"steering","value":"bad"}',
    '{"id":"compaction","value":"false","path":"/personal"}',
  ])
    await expect(settings.run(input)).rejects.toThrow();
  session.isStreaming = true;
  await expect(
    settings.run('{"id":"compaction","value":"false"}'),
  ).rejects.toThrow();
  session.isStreaming = false;
  session.settingsManager.drainErrors = () => [{}];
  await expect(
    settings.run('{"id":"compaction","value":"false"}'),
  ).rejects.toThrow();
});
