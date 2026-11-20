// Firstmate tasks the owner ticked on Home. Kept outside Home so that
// leaving Home within the Undo time never loses a completion (review of
// pull request 46): the request goes to Firstmate on time wherever the owner
// is, and a ticked task is still shown struck through on return.
import {
  tickUndoMs,
  tickedVisibleMs,
} from "../../../../packages/domain/src/work/held-tasks.ts";

export interface Ticked {
  at: number;
  sent: boolean;
}

type Send = (attentionId: string) => void;

export function tickedTasks(send: Send, now: () => number = Date.now) {
  let state: Record<string, Ticked> = {};
  const timers = new Map<string, ReturnType<typeof setTimeout>[]>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const set = (next: Record<string, Ticked>) => {
    state = next;
    emit();
  };
  const clear = (id: string) => {
    for (const timer of timers.get(id) ?? []) clearTimeout(timer);
    timers.delete(id);
  };
  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    tick(id: string) {
      if (state[id]) return;
      const at = now();
      set({ ...state, [id]: { at, sent: false } });
      timers.set(id, [
        setTimeout(() => {
          if (!state[id]) return;
          set({ ...state, [id]: { at, sent: true } });
          send(id);
        }, tickUndoMs),
        setTimeout(() => {
          const next = { ...state };
          delete next[id];
          timers.delete(id);
          set(next);
        }, tickedVisibleMs),
      ]);
    },
    /** Undo: only before the request has gone to Firstmate. */
    undo(id: string) {
      if (!state[id] || state[id]!.sent) return;
      clear(id);
      const next = { ...state };
      delete next[id];
      set(next);
    },
  };
}
