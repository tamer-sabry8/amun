import type { NativePiResult } from "./native-pi.ts";
interface Model {
  provider: string;
  id: string;
  name?: string;
}
export interface PreferenceSession {
  isStreaming: boolean;
  modelRuntime: { getAvailableSnapshot(): readonly Model[] };
  scopedModels: readonly { model: Model }[];
  cycleModel(
    direction: "forward" | "backward",
  ): Promise<{ model: Model } | undefined>;
  setScopedModels(models: { model: Model }[]): void;
  settingsManager: {
    getEnabledModels(): string[] | undefined;
    setEnabledModels(models: string[] | undefined): void;
    flush(): Promise<void>;
    drainErrors(): unknown[];
  };
}
export class NativePiPreferences {
  constructor(private session: PreferenceSession) {}
  async cycle(direction: string): Promise<NativePiResult> {
    if (direction !== "forward" && direction !== "backward")
      throw Error("Invalid model direction");
    await this.run("scoped-models", "");
    const models = this.session.modelRuntime.getAvailableSnapshot();
    const ids = this.session.settingsManager.getEnabledModels();
    this.session.setScopedModels(
      ids?.length
        ? models
            .filter((m) => ids.includes(m.provider + "/" + m.id))
            .map((model) => ({ model }))
        : [],
    );
    const result = await this.session.cycleModel(direction);
    return {
      kind: "message",
      text: result
        ? "Model selected: " + result.model.provider + "/" + result.model.id
        : "No alternative model available",
    };
  }
  async run(command: string, argument: string): Promise<NativePiResult> {
    if (
      command !== "scoped-models" ||
      argument.length > 512 ||
      argument.includes("\0")
    )
      throw Error("Invalid preference action");
    const s = this.session;
    if (s.isStreaming) throw Error("Wait for the current turn");
    const models = s.modelRuntime.getAvailableSnapshot();
    if (models.length > 2048) throw Error("Model catalog too large");
    const ids = models.map((m) => m.provider + "/" + m.id);
    if (ids.some((id) => id.length > 512) || new Set(ids).size !== ids.length)
      throw Error("Invalid model catalog");
    const saved = s.settingsManager.getEnabledModels();
    // Amun persists exact IDs. Do not silently reinterpret external wildcard preferences.
    if (saved?.some((id) => !ids.includes(id)))
      throw Error("Configured model scope needs review");
    let selected = saved?.length ? [...saved] : [...ids];
    if (argument) {
      if (!ids.includes(argument)) throw Error("Model unavailable");
      selected = selected.includes(argument)
        ? selected.filter((id) => id !== argument)
        : [...selected, argument];
      if (!selected.length) throw Error("Keep at least one model enabled");
      s.settingsManager.setEnabledModels(
        selected.length === ids.length ? undefined : selected,
      );
      await s.settingsManager.flush();
      if (s.settingsManager.drainErrors().length)
        throw Error("Could not save model scope");
      s.setScopedModels(
        selected.length === ids.length
          ? []
          : models
              .filter((m) => selected.includes(m.provider + "/" + m.id))
              .map((model) => ({ model })),
      );
    }
    return {
      kind: "choices",
      title: "Models for cycling — select to toggle",
      choices: models.map((m, index) => ({
        id: ids[index]!,
        label:
          (selected.includes(ids[index]!) ? "Included · " : "Excluded · ") +
          (m.name ?? m.id).slice(0, 230),
      })),
    };
  }
}
