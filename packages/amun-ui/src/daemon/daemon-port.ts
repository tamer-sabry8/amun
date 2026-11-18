// Supplies the renderer's MessagePort from the Amun daemon instead of the old
// Electron main process. The renderer code is unchanged: it still waits for
// {kind:"amun-port"} after posting "amun-renderer-ready".
import { AmunClient, defaultDaemonUrl } from "./amun-client.ts";
import { ContractAdapter } from "./contract-adapter.ts";

export function installDaemonPort(url: string = defaultDaemonUrl()) {
  const client = new AmunClient(url);
  const adapter = new ContractAdapter(client);
  let local: MessagePort | null = null;

  function offer() {
    local?.close();
    const channel = new MessageChannel();
    local = channel.port1;
    const current = local;
    current.onmessage = (message) => {
      void adapter.handle(message.data as Record<string, unknown>).then(
        (replies) => {
          if (local !== current) return;
          for (const reply of replies) current.postMessage(reply);
        },
        () => {},
      );
    };
    current.start();
    window.postMessage({ kind: "amun-port" }, "*", [channel.port2]);
  }

  window.addEventListener("message", (event) => {
    if (event.source === window && event.data?.kind === "amun-renderer-ready")
      offer();
  });
  // An answer to a held question lands (or fails) after its request returned.
  adapter.onChange = () => local?.postMessage(adapter.work());
  let wasConnected = false;
  let everConnected = false;
  client.onStatus((connected) => {
    // After a dropped daemon, hand the renderer a fresh port so it re-reads.
    if (connected && everConnected && !wasConnected && local) offer();
    if (connected) everConnected = true;
    if (!connected && wasConnected)
      window.postMessage({ kind: "amun-status", status: "reconnecting" }, "*");
    wasConnected = connected;
  });
  client.onEvent((event) => {
    if (!local) return;
    // Already in the renderer's own contract (a finished Notion sign-in).
    if (event.event === "renderer.event" && event.message) {
      local.postMessage(event.message);
      return;
    }
    if (
      event.event === "fleet.updated" ||
      event.event === "holds.updated" ||
      // A Council question arrived, or a council ended.
      event.event === "work.updated"
    ) {
      void adapter.refresh().then(
        () => local?.postMessage(adapter.work()),
        () => {},
      );
    }
  });
  return client;
}
