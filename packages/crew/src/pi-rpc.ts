import { randomUUID } from "node:crypto";
import { JsonLineDecoder } from "./jsonl.ts";

type Pending = {
  command: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type Dialog = {
  method: "select" | "confirm";
  options: string[];
  timer: ReturnType<typeof setTimeout>;
};
/** Service-side protocol transport. Event data is untrusted and must not be forwarded directly to renderer IPC. */
export class PiRpcClient {
  private decoder = new JsonLineDecoder();
  private pending = new Map<string, Pending>();
  private dialogs = new Map<string, Dialog>();
  private closed = false;
  private write: (line: string) => void;
  private event: (frame: Record<string, unknown>) => void;
  constructor(
    write: (line: string) => void,
    event: (frame: Record<string, unknown>) => void = () => {},
  ) {
    this.write = write;
    this.event = event;
  }
  request(
    command: string,
    payload: Record<string, unknown> = {},
    timeout = 15000,
  ): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Pi connection closed"));
    if (
      ![
        "get_state",
        "get_available_models",
        "get_commands",
        "prompt",
        "abort",
      ].includes(command) ||
      "id" in payload ||
      "type" in payload ||
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > 300000 ||
      this.pending.size >= 64
    )
      return Promise.reject(new Error("Invalid or excessive Pi request"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Pi request timed out; outcome unknown"));
      }, timeout);
      this.pending.set(id, { command, resolve, reject, timer });
      this.send({ ...payload, type: command, id });
    });
  }
  private send(frame: Record<string, unknown>): void {
    try {
      const line = JSON.stringify(frame);
      if (Buffer.byteLength(line) > 1048576) throw new Error();
      this.write(line + "\n");
    } catch {
      this.fail("Pi transport failure");
    }
  }
  receive(chunk: string): void {
    if (this.closed) return;
    try {
      for (const frame of this.decoder.push(chunk)) {
        if (this.closed) break;
        if (!frame || typeof frame !== "object" || Array.isArray(frame))
          throw new Error();
        const record = frame as Record<string, unknown>;
        if (typeof record.type !== "string") throw new Error();
        if (record.type === "response") {
          if (typeof record.id !== "string") continue;
          const pending = this.pending.get(record.id);
          if (!pending) continue; // late/unknown replies must not complete unrelated work
          if (
            record.command !== pending.command ||
            typeof record.success !== "boolean"
          )
            throw new Error();
          clearTimeout(pending.timer);
          this.pending.delete(record.id);
          if (record.success) pending.resolve(record.data);
          else pending.reject(new Error("Pi command failed"));
        } else if (record.type === "extension_ui_request") {
          this.dialog(record);
        } else this.event(record);
      }
    } catch {
      this.fail("Pi protocol failure");
    }
  }
  private dialog(frame: Record<string, unknown>): void {
    const { id, method } = frame;
    if (
      typeof id !== "string" ||
      !id ||
      typeof method !== "string" ||
      this.dialogs.has(id)
    )
      throw new Error();
    if (method !== "select" && method !== "confirm") {
      // Unsupported input methods fail closed; passive extension updates need no reply.
      if (method === "input" || method === "editor")
        this.send({ type: "extension_ui_response", id, cancelled: true });
      else this.event(frame);
      return;
    }
    if (typeof frame.title !== "string" || this.dialogs.size >= 64)
      throw new Error();
    const options = frame.options;
    if (
      method === "select" &&
      (!Array.isArray(options) || !options.every((x) => typeof x === "string"))
    )
      throw new Error();
    if (method === "confirm" && typeof frame.message !== "string")
      throw new Error();
    const timeout = frame.timeout ?? 60000;
    if (
      typeof timeout !== "number" ||
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > 300000
    )
      throw new Error();
    const timer = setTimeout(() => this.answer(id, null), timeout);
    this.dialogs.set(id, {
      method,
      options: method === "select" ? [...(options as string[])] : [],
      timer,
    });
    this.event(frame);
  }
  answer(id: string, answer: string | boolean | null): void {
    const dialog = this.dialogs.get(id);
    if (this.closed || !dialog) throw new Error("Unknown or expired Pi dialog");
    if (
      answer !== null &&
      (dialog.method === "select"
        ? typeof answer !== "string" || !dialog.options.includes(answer)
        : typeof answer !== "boolean")
    )
      throw new Error("Invalid Pi dialog answer");
    clearTimeout(dialog.timer);
    this.dialogs.delete(id);
    this.send({
      type: "extension_ui_response",
      id,
      ...(answer === null
        ? { cancelled: true }
        : dialog.method === "select"
          ? { value: answer }
          : { confirmed: answer }),
    });
  }
  close(): void {
    this.fail("Pi connection closed");
  }
  private fail(message: string): void {
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
    for (const dialog of this.dialogs.values()) clearTimeout(dialog.timer);
    this.dialogs.clear();
  }
}
