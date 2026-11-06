type QueueMode = "all" | "one-at-a-time";
export interface SettingsSession {
  isStreaming: boolean;
  autoCompactionEnabled: boolean;
  autoRetryEnabled: boolean;
  steeringMode: QueueMode;
  followUpMode: QueueMode;
  setAutoCompactionEnabled(value: boolean): void;
  setAutoRetryEnabled(value: boolean): void;
  setSteeringMode(value: QueueMode): void;
  setFollowUpMode(value: QueueMode): void;
  settingsManager: {
    getBlockImages(): boolean;
    setBlockImages(value: boolean): void;
    getEnableSkillCommands(): boolean;
    setEnableSkillCommands(value: boolean): void;
    flush(): Promise<void>;
    drainErrors(): unknown[];
  };
}
export class NativePiSettings {
  constructor(private session: SettingsSession) {}
  async run(argument: string): Promise<{
    kind: "preferences";
    fields: { id: string; label: string; value: string; options: string[] }[];
  }> {
    const s = this.session,
      m = s.settingsManager;
    const booleanOptions = ["true", "false"],
      queueOptions = ["one-at-a-time", "all"];
    const definitions = [
      {
        id: "compaction",
        label: "Automatic context compaction",
        value: String(s.autoCompactionEnabled),
        options: booleanOptions,
        set: (v: string) => s.setAutoCompactionEnabled(v === "true"),
      },
      {
        id: "retry",
        label: "Automatic model retry",
        value: String(s.autoRetryEnabled),
        options: booleanOptions,
        set: (v: string) => s.setAutoRetryEnabled(v === "true"),
      },
      {
        id: "steering",
        label: "Steering queue delivery",
        value: s.steeringMode,
        options: queueOptions,
        set: (v: string) => s.setSteeringMode(v as QueueMode),
      },
      {
        id: "follow-up",
        label: "Follow-up queue delivery",
        value: s.followUpMode,
        options: queueOptions,
        set: (v: string) => s.setFollowUpMode(v as QueueMode),
      },
      {
        id: "block-images",
        label: "Block images sent to models",
        value: String(m.getBlockImages()),
        options: booleanOptions,
        set: (v: string) => m.setBlockImages(v === "true"),
      },
      {
        id: "skill-commands",
        label: "Enable loaded skill commands",
        value: String(m.getEnableSkillCommands()),
        options: booleanOptions,
        set: (v: string) => m.setEnableSkillCommands(v === "true"),
      },
    ];
    if (argument) {
      if (s.isStreaming || argument.length > 1024)
        throw Error("Busy session or invalid settings change");
      const input: unknown = JSON.parse(argument);
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).length !== 2 ||
        !("id" in input) ||
        !("value" in input) ||
        typeof input.id !== "string" ||
        typeof input.value !== "string"
      )
        throw Error("Invalid settings change");
      const definition = definitions.find((d) => d.id === input.id);
      if (!definition || !definition.options.includes(input.value))
        throw Error("Unsupported setting or value");
      definition.set(input.value);
      await m.flush();
      if (m.drainErrors().length) throw Error("Settings could not be saved");
      return this.run("");
    }
    return {
      kind: "preferences" as const,
      fields: definitions.map(({ id, label, value, options }) => ({
        id,
        label,
        value,
        options,
      })),
    };
  }
}
