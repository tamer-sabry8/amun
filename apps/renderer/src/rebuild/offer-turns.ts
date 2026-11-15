// Accepting one of Firstmate's offers is a request to Firstmate to draft it.
// The request becomes a real message in the work's conversation, so it is
// either answered, or kept as a waiting message, or reported as interrupted.
// It is never shown as running without a turn behind it.

export interface OfferTurn {
  id: string;
  areaId: string;
  text: string;
  state: "queued" | "sending";
}
interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const key = "amun.offer-turns";

/** What the owner is asking for, in the words sent to Firstmate. */
export const offerRequest = (title: string, detail: string) =>
  `Yes, please draft this: ${title}.${detail ? " " + detail : ""} Draft only. Do not send anything or change any approval.`;

/** The owner asked for changes to a plan Firstmate proposed. */
export const changesRequest = (summary: string, note = "") =>
  `I asked for changes to the plan "${summary}".${note ? ` My note: ${note}` : ""} Nothing was published. Bring back a revised proposal, or ask me what to change if you need to know. Do not publish or approve anything.`;

/** The owner chose an answer on one of Firstmate's question cards. */
export const answerRequest = (title: string, answer: string) =>
  `My answer to your question "${title}": ${answer}. Carry it out: confirm it briefly, record any risk or decision it implies, or hand the work to the right agent, as that answer calls for. Do not publish or approve anything.`;

export function offerTurns(storage: Storage | null) {
  const turns = new Map<string, OfferTurn>();
  /** Turns being sent in this run, as opposed to ones a restart cut short. */
  const live = new Set<string>();
  try {
    for (const turn of JSON.parse(storage?.getItem(key) ?? "[]") as OfferTurn[])
      if (turn?.id && turn.areaId && typeof turn.text === "string")
        turns.set(turn.id, turn);
  } catch {
    // A damaged list only loses the pending request, never the offer.
  }
  const listeners = new Set<() => void>();
  const save = () => {
    try {
      storage?.setItem(key, JSON.stringify([...turns.values()]));
    } catch {
      // Best effort; this run still holds the list.
    }
  };
  return {
    /** Adds the request once per offer, however often it is accepted. */
    queue(turn: Omit<OfferTurn, "state">) {
      if (turns.has(turn.id)) return false;
      turns.set(turn.id, { ...turn, state: "queued" });
      save();
      for (const listener of [...listeners]) listener();
      return true;
    },
    /**
     * What this work area should do now: send each queued request once, and
     * report those a restart interrupted (they were being sent, and nothing
     * in this run is still sending them). Interrupted ones are dropped.
     */
    claim(areaId: string) {
      const send: OfferTurn[] = [];
      const interrupted: OfferTurn[] = [];
      for (const turn of [...turns.values()]) {
        if (turn.areaId !== areaId) continue;
        if (turn.state === "queued") {
          turn.state = "sending";
          live.add(turn.id);
          send.push({ ...turn });
        } else if (!live.has(turn.id)) {
          turns.delete(turn.id);
          interrupted.push({ ...turn });
        }
      }
      if (send.length || interrupted.length) save();
      return { send, interrupted };
    },
    /** The turn reached Firstmate's conversation (answered, or kept waiting). */
    done(id: string) {
      live.delete(id);
      if (turns.delete(id)) save();
    },
    /** Tells the listener whenever a new request is queued. */
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    pending: (areaId: string) =>
      [...turns.values()].filter((turn) => turn.areaId === areaId),
  };
}

export const pendingOffers = offerTurns(
  typeof localStorage === "undefined" ? null : localStorage,
);
