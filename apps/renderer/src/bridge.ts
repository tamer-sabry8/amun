import {
  healthRequest,
  healthResponse,
  workspaceEvent,
  authEvent,
  terminalEvent,
  piEvent,
  crewObservation,
  type WorkspaceSnapshot,
  type AuthEvent,
} from "@amun/contracts";
export type ServiceEvent = unknown;
interface BridgeState {
  status: "Connecting" | "Connected" | "Reconnecting";
  workspace: WorkspaceSnapshot | null;
  connections: Extract<AuthEvent, { kind: "auth-connections" }>["connections"];
  modelStatus: Record<string, string>;
  prompt: Extract<AuthEvent, { kind: "auth-prompt" }> | null;
  notice: string;
  search: { id: string; kind: string; title: string }[];
  searchQuery: string;
}
let state: BridgeState = {
  status: "Connecting",
  workspace: null,
  connections: [],
  modelStatus: {},
  prompt: null,
  notice: "",
  search: [],
  searchQuery: "",
};
let port: MessagePort | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const eventListeners = new Set<(event: ServiceEvent) => void>();
const update = (next: Partial<BridgeState>) => {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
};
export const bridge = {
  getSnapshot: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  onEvent: (listener: (event: ServiceEvent) => void) => {
    eventListeners.add(listener);
    return () => {
      eventListeners.delete(listener);
    };
  },
  send: (message: unknown) => port?.postMessage(message),
  clearPrompt: () => update({ prompt: null }),
  clearNotice: () => update({ notice: "" }),
};
export function initializeBridge() {
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (
      event.data?.kind === "amun-status" &&
      event.data.status === "reconnecting"
    ) {
      clearTimeout(timer);
      port?.close();
      port = undefined;
      update({ status: "Reconnecting", prompt: null, modelStatus: {} });
      for (const listener of eventListeners) listener({ kind: "service-lost" });
      return;
    }
    if (event.data?.kind !== "amun-port" || !event.ports[0]) return;
    port?.close();
    clearTimeout(timer);
    const current = event.ports[0];
    port = current;
    const id = crypto.randomUUID();
    current.onmessage = (message) => {
      if (port !== current) return;
      const health = healthResponse.safeParse(message.data);
      if (health.success && health.data.id === id) {
        clearTimeout(timer);
        if (health.data.status !== "ready") {
          update({ status: "Reconnecting" });
          return;
        }
        update({ status: "Connected" });
        bridge.send({ version: 1, kind: "workspace", action: "snapshot" });
        bridge.send({ version: 1, kind: "auth", action: "list" });
        return;
      }
      const workspace = workspaceEvent.safeParse(message.data);
      if (workspace.success) {
        const event = workspace.data;
        if (event.kind === "workspace-snapshot") update({ workspace: event });
        else if (event.kind === "workspace-search")
          update({ search: event.results, searchQuery: event.query });
        else update({ notice: event.message });
        return;
      }
      const auth = authEvent.safeParse(message.data);
      if (auth.success) {
        const event = auth.data;
        if (event.kind === "auth-connections")
          update({ connections: event.connections });
        else if (event.kind === "auth-prompt") update({ prompt: event });
        else if (event.kind === "auth-notice")
          update({ notice: event.message });
        else
          update({
            modelStatus: { ...state.modelStatus, [event.id]: event.status },
            ...(["checking", "configured", "ready", "cancelled"].includes(
              event.status,
            )
              ? { notice: "" }
              : {}),
            ...(["configured", "error", "cancelled"].includes(event.status)
              ? { prompt: null }
              : {}),
          });
        return;
      }
      const validated = terminalEvent.safeParse(message.data);
      const pi = piEvent.safeParse(message.data);
      const crew = crewObservation.safeParse(message.data);
      if (validated.success || pi.success || crew.success)
        for (const listener of eventListeners) listener(message.data);
    };
    current.start();
    current.postMessage(
      healthRequest.parse({ version: 1, id, method: "health", params: {} }),
    );
    timer = setTimeout(() => update({ status: "Reconnecting" }), 3000);
  });
  setInterval(() => {
    if (state.status === "Connected")
      bridge.send({ version: 1, kind: "workspace", action: "snapshot" });
  }, 5000);
}
