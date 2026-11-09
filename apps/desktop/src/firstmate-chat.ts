import {
  chatCommand,
  type ChatTurn,
} from "../../../packages/contracts/src/firstmate-chat.ts";
import type { FirstmateChat } from "../../../packages/data/src/firstmate-chat.ts";
import type { FirstmateSupervision } from "../../service/src/firstmate-supervision.ts";
export class ChatSession {
  private current: ChatTurn | undefined;
  private queue: ChatTurn[] = [];
  constructor(
    private chat: FirstmateChat,
    private primary: FirstmateSupervision,
    private selected: () => string | null,
    private send: (message: unknown) => void,
  ) {}
  async handle(input: unknown) {
    const parsed = chatCommand.safeParse(input);
    if (!parsed.success) return;
    const cmd = parsed.data;
    if (cmd.action === "history") {
      if (this.selected() === cmd.productId)
        this.send({
          kind: "firstmate-chat-result",
          phase: "history",
          productId: cmd.productId,
          id: cmd.id,
          history: this.chat.history(cmd.productId),
          text: "",
        });
      return;
    }
    const turn = cmd.turn;
    if (this.selected() !== turn.productId) return;
    if (cmd.action !== "send") {
      if (
        this.current?.productId !== turn.productId ||
        this.queue.length >= 8
      ) {
        this.emit(turn, "error", "The turn has ended or the queue is full.");
        return;
      }
      if (cmd.action === "steer") this.queue.unshift(turn);
      else this.queue.push(turn);
      this.emit(
        turn,
        "queued",
        cmd.action === "steer"
          ? "Steering queued for the next reply."
          : "Follow-up queued.",
      );
      return;
    }
    if (this.current) {
      this.emit(turn, "error", "Firstmate is answering another message.");
      return;
    }
    this.current = turn;
    try {
      while (this.current && this.selected() === this.current.productId) {
        const t: ChatTurn = this.current;
        let begun = false;
        try {
          const model = this.chat.model(t);
          const context = this.chat.begin({ ...t, model });
          begun = true;
          const reply = await this.primary.productTurn(
            model,
            "You are Firstmate, the product manager's collaborator. Answer the current message using the selected record and conversation history as reference. This conversation has no authority to approve or execute actions.",
            context,
            (text) => this.emit(t, "stream", text),
          );
          this.chat.finish(t.id, t.productId, reply);
          this.emit(t, "done", reply);
        } catch (err) {
          if (begun) this.chat.finish(t.id, t.productId, null);
          this.emit(
            t,
            "error",
            begun
              ? "Firstmate could not complete this turn. Check the model connection."
              : err instanceof Error && !err.message.includes("SQLITE")
                ? err.message
                : "Conversation unavailable.",
          );
        }
        this.current = this.queue.shift();
      }
    } finally {
      this.current = undefined;
      this.queue = [];
    }
  }
  private emit(t: ChatTurn, phase: string, text: string) {
    if (this.selected() === t.productId)
      this.send({
        kind: "firstmate-chat-result",
        productId: t.productId,
        id: t.id,
        phase,
        text,
        ...(phase === "done" || phase === "error"
          ? { history: this.chat.history(t.productId) }
          : {}),
      });
  }
}
