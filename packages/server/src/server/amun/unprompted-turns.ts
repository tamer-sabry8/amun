import type { AgentManagerEvent } from "../agent/agent-manager.js";

/** The First Mate said something on a turn Amun did not ask for. */
export interface UnpromptedReply {
  fmHome: string;
  agentId: string;
  text: string;
}

export interface UnpromptedTurnsInput {
  /** The home this agent is the First Mate of, or null for any other agent. */
  homeOf(agentId: string): string | null;
  /** Whether the turn now running was asked for by Amun (`primary.send`). */
  isAmunTurn(agentId: string): boolean;
  onReply(reply: UnpromptedReply): void;
}

interface OpenTurn {
  fromAmun: boolean;
  /** The last assistant message, in streamed chunks. */
  chunks: string[];
  /** Whether the last timeline item was part of that message. */
  inMessage: boolean;
}

/**
 * Watches the First Mate's turns. A turn that Amun did not start, such as a
 * Paseo heartbeat (a timed prompt to itself) or a Firstmate wake or guard
 * notice, has a reply nobody is waiting for; this hands that reply on so the
 * captain sees it. Turns Amun started are answered by `primary.send` already.
 */
export class UnpromptedTurns {
  private readonly open = new Map<string, OpenTurn>();

  constructor(private readonly input: UnpromptedTurnsInput) {}

  handle(event: AgentManagerEvent): void {
    if (event.type === "agent_removed") {
      this.open.delete(event.agentId);
      return;
    }
    if (event.type !== "agent_stream") return;
    const { agentId } = event;
    const fmHome = this.input.homeOf(agentId);
    if (!fmHome) return;
    const stream = event.event;
    switch (stream.type) {
      case "turn_started":
        this.open.set(agentId, {
          fromAmun: this.input.isAmunTurn(agentId),
          chunks: [],
          inMessage: false,
        });
        return;
      case "timeline": {
        const turn = this.turnFor(agentId);
        if (stream.item.type === "assistant_message") {
          if (!turn.inMessage) turn.chunks = [];
          turn.chunks.push(stream.item.text);
          turn.inMessage = true;
        } else {
          turn.inMessage = false;
        }
        return;
      }
      case "turn_completed": {
        const turn = this.open.get(agentId);
        this.open.delete(agentId);
        if (!turn || turn.fromAmun) return;
        const text = turn.chunks.join("").trim();
        if (text) this.input.onReply({ fmHome, agentId, text });
        return;
      }
      case "turn_failed":
      case "turn_canceled":
        this.open.delete(agentId);
        return;
      default:
        return;
    }
  }

  /** A turn whose start was missed is judged by who is waiting on it now. */
  private turnFor(agentId: string): OpenTurn {
    let turn = this.open.get(agentId);
    if (!turn) {
      turn = { fromAmun: this.input.isAmunTurn(agentId), chunks: [], inMessage: false };
      this.open.set(agentId, turn);
    }
    return turn;
  }
}
