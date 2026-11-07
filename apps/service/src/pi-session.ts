import { piCommand, piEvent, type PiEvent } from "@amun/contracts";
import { PiRpcClient } from "../../../packages/crew/src/pi-rpc.ts";
import { InferenceEvidence } from "../../../packages/crew/src/pi-inference.ts";
/** Only this bounded projection crosses the renderer port; raw runtime records stay here. */
export class PiSession {
  private client: PiRpcClient;
  private evidence = new InferenceEvidence();
  private total = 0;
  private closed = false;
  private send: (event: PiEvent) => void;
  private stop: () => void;
  constructor(
    write: (line: string) => void,
    send: (event: PiEvent) => void,
    stop: () => void,
  ) {
    this.send = send;
    this.stop = stop;
    this.client = new PiRpcClient(write, (frame) => this.project(frame));
  }
  async ready(
    expected?: { provider: string; model: string },
    bridgeReady = () => true,
  ): Promise<void> {
    const response = (await this.client.request("get_available_models")) as {
      models?: unknown;
    };
    if (
      !response ||
      !Array.isArray(response.models) ||
      response.models.length > 2048
    )
      throw new Error("Invalid model response");
    const models = response.models.map((item: unknown) => {
      if (!item || typeof item !== "object") throw new Error("Invalid model");
      const model = item as Record<string, unknown>;
      return { provider: model.provider, id: model.id };
    });
    const projected = piEvent.parse({ version: 1, kind: "pi-models", models });
    if (
      expected &&
      !models.some(
        (model) =>
          model.provider === expected.provider && model.id === expected.model,
      )
    )
      throw new Error("Selected model unavailable");
    if (this.closed) throw new Error("Pi closed");
    if (!bridgeReady()) throw Error("Bridge unavailable");
    this.send(projected);
    this.state("ready");
  }
  receive(chunk: string): void {
    if (!this.closed) this.client.receive(chunk);
  }
  private state(
    state: "ready" | "running" | "complete" | "closed" | "unavailable",
  ) {
    this.send({ version: 1, kind: "pi-state", state });
  }
  private project(frame: Record<string, unknown>): void {
    if (this.closed) return;
    if (
      frame.type === "extension_ui_request" &&
      (frame.method === "select" || frame.method === "confirm")
    ) {
      const projected = piEvent.safeParse({
        version: 1,
        kind: "pi-dialog",
        id: frame.id,
        method: frame.method,
        title: frame.title,
        ...(frame.method === "select"
          ? { options: frame.options }
          : { message: frame.message }),
      });
      if (projected.success) this.send(projected.data);
      else if (typeof frame.id === "string") this.client.answer(frame.id, null);
      return;
    }
    if (frame.type === "message_update") {
      const event = frame.assistantMessageEvent;
      if (
        event &&
        typeof event === "object" &&
        "type" in event &&
        event.type === "text_delta"
      ) {
        if (
          !("delta" in event) ||
          typeof event.delta !== "string" ||
          event.delta.length > 65536 ||
          this.total + event.delta.length > 262144
        ) {
          this.close();
          this.state("unavailable");
          return;
        }
        this.total += event.delta.length;
        this.send({ version: 1, kind: "pi-text", text: event.delta });
      }
    }
    this.evidence.accept(frame);
    if (this.evidence.complete) this.state("complete");
    else if (this.evidence.failed) {
      this.close();
      this.state("unavailable");
    }
  }
  async handle(input: unknown): Promise<void> {
    const parsed = piCommand.safeParse(input);
    if (!parsed.success || this.closed) return;
    const command = parsed.data;
    try {
      if (command.action === "close") {
        this.close();
        return;
      }
      if (command.action === "answer") {
        this.client.answer(command.id, command.answer);
        return;
      }
      if (command.action === "prompt") {
        this.evidence = new InferenceEvidence();
        this.state("running");
        await this.client.request("prompt", { message: command.message });
      } else await this.client.request("abort");
    } catch {
      // Invalid or expired answers do not terminate unrelated runtime work.
      if (command.action !== "answer") {
        this.close();
        this.state("unavailable");
      }
    }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.client.close();
    this.stop();
    this.state("closed");
  }
}
