// Renderer-side store for the UX rebuild model. Holds the latest snapshot and
// the most recent command result; views read it with useSyncExternalStore.
import {
  workEvent,
  type CouncilStatus,
  type WorkCommand,
  type WorkSnapshot,
} from "../../../../packages/contracts/src/work.ts";
import { bridge } from "../bridge.ts";

export interface WorkResult {
  commandId?: string | undefined;
  action: string;
  ok: boolean;
  message: string;
  ref: string | null;
  step: unknown;
}
interface State {
  snapshot: WorkSnapshot | null;
  result: WorkResult | null;
  council: CouncilStatus | null;
  /** Why the workspace could not be read: paths and codes, never values. */
  failure: string[] | null;
}
let state: State = {
  snapshot: null,
  result: null,
  council: null,
  failure: null,
};
const listeners = new Set<() => void>();
const resultListeners = new Set<(result: WorkResult) => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

/** Applies one service event. Exported so tests can drive the store directly. */
export function receive(raw: unknown) {
  const parsed = workEvent.safeParse(raw);
  if (!parsed.success) return false;
  if (parsed.data.kind === "work-snapshot")
    state = { ...state, snapshot: parsed.data, failure: null };
  else if (parsed.data.kind === "work-snapshot-failed")
    state = { ...state, failure: parsed.data.reasons };
  else if (parsed.data.kind === "council-status")
    state = { ...state, council: parsed.data };
  else if (parsed.data.kind !== "work-result") return false;
  else {
    const { commandId, action, ok, message, ref, step } = parsed.data;
    const result = { commandId, action, ok, message, ref, step };
    state = { ...state, result };
    for (const listener of resultListeners) listener(result);
  }
  emit();
  return true;
}
let connected = false;
export function connectWorkStore() {
  if (connected) return;
  connected = true;
  bridge.onEvent(receive);
}
export const workStore = {
  getSnapshot: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  onResult: (listener: (result: WorkResult) => void) => {
    resultListeners.add(listener);
    return () => {
      resultListeners.delete(listener);
    };
  },
  clearResult: () => {
    state = { ...state, result: null };
    emit();
  },
  reset: () => {
    state = { snapshot: null, result: null, council: null, failure: null };
    emit();
  },
};
/** Asks the service for the workspace again, after a failure. */
export function retryWorkSnapshot() {
  state = { ...state, failure: null };
  emit();
  bridge.send({ version: 1, kind: "work", action: "snapshot" });
}

type Action = WorkCommand["action"];
type Payload<A extends Action> = Omit<
  Extract<WorkCommand, { action: A }>,
  "version" | "kind" | "action"
>;
/** Sends one command. Fields with defaults in the contract may be omitted. */
export function work<A extends Action>(
  action: A,
  payload?: Partial<Payload<A>>,
) {
  bridge.send({ version: 1, kind: "work", action, ...payload });
}
/**
 * Sends a command and resolves with its result once the snapshot that follows
 * it has arrived, so callers can rely on what they just created being there.
 */
export function workAsync<A extends Action>(
  action: A,
  payload?: Partial<Payload<A>>,
) {
  const commandId = crypto.randomUUID();
  return new Promise<WorkResult>((resolve) => {
    const stop = workStore.onResult((result) => {
      if (result.action !== action || result.commandId !== commandId) return;
      stop();
      clearTimeout(responseTimer);
      const before = state.snapshot;
      const settle = workStore.subscribe(() => {
        if (state.snapshot === before) return;
        settle();
        clearTimeout(timer);
        resolve(result);
      });
      // The service always follows a result with a snapshot; never hang if not.
      const timer = setTimeout(() => {
        settle();
        resolve(result);
      }, 1500);
    });
    const responseTimer = setTimeout(() => {
      stop();
      resolve({
        commandId,
        action,
        ok: false,
        ref: null,
        step: null,
        message:
          "Amun has not confirmed the request. Check Activity before retrying.",
      });
    }, 30_000);
    bridge.send({ version: 1, kind: "work", action, ...payload, commandId });
  });
}
/** Council commands run in the service: status, a run, seats and updates. */
export function council(action: string, payload: Record<string, unknown> = {}) {
  bridge.send({ version: 1, kind: "council", action, ...payload });
}
