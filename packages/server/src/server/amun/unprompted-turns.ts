import type { AgentManagerEvent } from "../agent/agent-manager.js";

/** The First Mate said something on a turn Amun did not ask for. */
export interface UnpromptedReply {
  fmHome: string;
  agentId: string;
  text: string;
}

/**
 * Firstmate's "nothing to report" answer to a wake ("Captain, shipshape.").
 * It is not shown in the chat: a wake that finds nothing new is not news.
 */
export function isAllClear(text: string): boolean {
  const said = text.replace(/\s+/g, " ").trim();
  return (
    said.length <= 80 &&
    /^(?:captain[,.!]?\s*)?(?:shipshape|all clear|all quiet|nothing (?:new|to report))\b[.!]?$/i.test(
      said.replace(/^aye[,.!]?\s*/i, ""),
    )
  );
}

/**
 * The replies in one run of the First Mate, in order. A run can hold more
 * than the turn Amun asked for: a Firstmate wake that arrives while it is
 * still answering is handled in the same run. The first reply belongs to the
 * owner's message; the rest are replies to those wakes.
 */
export function repliesInRun(
  timeline: readonly { type: string; text?: unknown }[],
): string[] {
  const replies: string[] = [];
  let current: string | null = null;
  let previous = "";
  for (const item of timeline) {
    if (item.type === "user_message") {
      if (current?.trim()) replies.push(current.trim());
      current = null;
    } else if (item.type === "assistant_message" && typeof item.text === "string") {
      // A reply streams in pieces; a tool call between pieces starts a new message.
      current = previous === "assistant_message" && current !== null ? current + item.text : item.text;
    }
    previous = item.type;
  }
  if (current?.trim()) replies.push(current.trim());
  return replies;
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
