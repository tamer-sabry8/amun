import { randomUUID } from "node:crypto";
import type { NativePiEvent } from "../../contracts/src/native-pi.ts";
type Answer = string | boolean | null;
type Dialog = Extract<NativePiEvent["result"], { kind: "extension-dialog" }>;
export interface ExtensionSession {
  extensionRunner: {
    getRegisteredCommands(): { name: string }[];
    getCommand(
      name: string,
    ):
      | { handler: (arg: string, ctx: object) => Promise<void> | void }
      | undefined;
    createCommandContext(): object;
  };
}
export const extensionNames = (s: ExtensionSession) =>
  s.extensionRunner
    .getRegisteredCommands()
    .map((c) => c.name)
    .filter((name) => /^[a-z][\w-]{0,63}$/.test(name))
    .slice(0, 256);
export class NativeExtensionUI {
  private waiting:
    { turn: string; dialog: Dialog; done: (v: Answer) => void } | undefined;
  answer(turn: string, id: string, value: Answer) {
    const p = this.waiting;
    if (!p || p.turn !== turn || p.dialog.dialog !== id) return;
    if (
      value !== null &&
      (p.dialog.method === "confirm"
        ? typeof value !== "boolean"
        : typeof value !== "string" ||
          value.length > 4096 ||
          (p.dialog.method === "select" && !p.dialog.options.includes(value)))
    )
      return;
    p.done(value);
  }
  close() {
    this.waiting?.done(null);
  }
  async run(
    s: ExtensionSession,
    turn: string,
    name: string,
    args: string,
    publish: (d: Dialog) => void,
    redact: (s: string) => string,
  ) {
    if (!extensionNames(s).includes(name))
      throw Error("Unknown extension command");
    const command = s.extensionRunner.getCommand(name);
    if (!command) throw Error("Unavailable extension command");
    const notifications: string[] = [];
    const ask = (
      method: Dialog["method"],
      label: string,
      text = "",
      choices: string[] = [],
    ) => {
      if (
        this.waiting ||
        choices.length > 128 ||
        choices.some((c) => typeof c !== "string" || c.length > 256)
      )
        throw Error("Unsupported dialog");
      const options = choices.map(redact);
      if (new Set(options).size !== choices.length)
        throw Error("Ambiguous choices");
      const dialog: Dialog = {
        kind: "extension-dialog",
        dialog: randomUUID(),
        method,
        title: redact(label).slice(0, 256),
        message: redact(text).slice(0, 4096),
        options,
      };
      return new Promise<Answer>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.waiting = undefined;
          reject(Error("Dialog expired"));
        }, 45000);
        this.waiting = {
          turn,
          dialog,
          done: (v) => {
            clearTimeout(timer);
            this.waiting = undefined;
            resolve(
              method === "select" && typeof v === "string"
                ? choices[options.indexOf(v)]!
                : v,
            );
          },
        };
        try {
          publish(dialog);
        } catch (e) {
          clearTimeout(timer);
          this.waiting = undefined;
          reject(e);
        }
      });
    };
    const ui = {
      notify: (text: string) => {
        if (notifications.length < 16)
          notifications.push(redact(String(text)).slice(0, 4096));
      },
      confirm: async (title: string, message: string) =>
        (await ask("confirm", title, message)) === true,
      select: async (title: string, options: string[]) =>
        (await ask("select", title, "", options)) ?? undefined,
      input: async (title: string, placeholder = "") =>
        (await ask("input", title, placeholder)) ?? undefined,
      editor: async (title: string, prefill = "") =>
        (await ask("editor", title, prefill)) ?? undefined,
    };
    const context = Object.create(s.extensionRunner.createCommandContext(), {
      ui: { value: ui },
      hasUI: { value: true },
    });
    try {
      await command.handler(args, context);
      return notifications.join("\n") || "Extension command completed.";
    } finally {
      if (this.waiting?.turn === turn) this.close();
    }
  }
}
