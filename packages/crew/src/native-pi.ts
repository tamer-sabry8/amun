interface Model {
  provider: string;
  id: string;
  name?: string;
}
export interface NativePiSession {
  isStreaming: boolean;
  sessionName: string | undefined;
  thinkingLevel: string;
  model: Model | undefined;
  modelRuntime: { getAvailableSnapshot(): readonly Model[] };
  cycleThinkingLevel(): string | undefined;
  getAvailableThinkingLevels(): string[];
  setThinkingLevel(level: string): void;
  setModel(model: Model): Promise<void>;
  setSessionName(name: string): void;
  getLastAssistantText(): string | undefined;
  getSessionStats(): unknown;
  compact(instructions?: string): Promise<unknown>;
  reload(): Promise<void>;
  abort(): Promise<void>;
}
export type NativePiResult =
  | {
      kind: "session-tree";
      rows: ReturnType<typeof import("./native-session-tree.ts").sessionTree>;
    }
  | { kind: "choices"; title: string; choices: { id: string; label: string }[] }
  | { kind: "message"; text: string }
  | { kind: "copy"; text: string }
  | { kind: "stats"; values: { label: string; value: number }[] };
function bounded(value: string, max = 4096): string {
  if (value.length > max || value.includes("\0"))
    throw Error("Invalid native command value");
  return value;
}
/** SDK adapters return explicit bounded views, never raw runtime objects. */
export class NativePiActions {
  constructor(private readonly session: NativePiSession) {}
  async run(command: string, argument: string): Promise<NativePiResult> {
    bounded(argument, 16384);
    const s = this.session;
    if (s.isStreaming && !["session", "copy"].includes(command))
      throw Error("Wait for the current turn or abort it first");
    if (command === "model") {
      const models = s.modelRuntime.getAvailableSnapshot();
      if (models.length > 2048) throw Error("Model catalog too large");
      const choices = models.map((m) => ({
        id: bounded(m.provider, 128) + "/" + bounded(m.id, 256),
        label: bounded(m.name ?? m.id, 256),
      }));
      if (!argument) return { kind: "choices", title: "Select model", choices };
      const index = choices.findIndex((m) => m.id === argument);
      if (index < 0) throw Error("Model unavailable");
      await s.setModel(models[index]!);
      return { kind: "message", text: "Model selected: " + argument };
    }
    if (command === "cycle-thinking") {
      if (argument) throw Error("Unexpected thinking cycle argument");
      const level = s.cycleThinkingLevel();
      return {
        kind: "message",
        text:
          level === undefined
            ? "This model has no thinking levels to cycle."
            : "Thinking level: " + bounded(level, 32),
      };
    }
    if (command === "thinking") {
      const levels = s.getAvailableThinkingLevels();
      if (levels.length > 16) throw Error("Invalid thinking levels");
      if (!argument)
        return {
          kind: "choices",
          title: "Thinking level",
          choices: levels.map((level) => ({
            id: bounded(level, 32),
            label: level,
          })),
        };
      if (!levels.includes(argument)) throw Error("Thinking level unavailable");
      s.setThinkingLevel(argument);
      return { kind: "message", text: "Thinking level selected: " + argument };
    }
    if (command === "name") {
      if (argument) s.setSessionName(bounded(argument, 256));
      return {
        kind: "message",
        text: argument || bounded(s.sessionName ?? "Unnamed session", 256),
      };
    }
    if (command === "copy")
      return {
        kind: "copy",
        text: bounded(s.getLastAssistantText() ?? "", 262144),
      };
    if (command === "session") {
      const raw = s.getSessionStats();
      if (!raw || typeof raw !== "object")
        throw Error("Session statistics unavailable");
      const values = [
        "userMessages",
        "assistantMessages",
        "toolCalls",
        "toolResults",
        "totalCost",
      ].flatMap((label) => {
        const value = (raw as Record<string, unknown>)[label];
        return typeof value === "number" && Number.isFinite(value) && value >= 0
          ? [{ label, value }]
          : [];
      });
      return { kind: "stats", values };
    }
    if (command === "compact") {
      await s.compact(argument || undefined);
      return { kind: "message", text: "Context compacted" };
    }
    if (command === "reload") {
      await s.reload();
      return { kind: "message", text: "Session resources reloaded" };
    }
    throw Error("Native action adapter unavailable");
  }
}
