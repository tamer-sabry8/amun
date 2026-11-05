import { healthRequest, healthResponse } from "@amun/contracts";

let currentPort: MessagePort | undefined;
let timeout: ReturnType<typeof setTimeout> | undefined;
const status = document.getElementById("service-status");
function show(text: string): void {
  if (status) status.textContent = text;
}
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (
    event.data?.kind === "amun-status" &&
    event.data.status === "reconnecting"
  ) {
    clearTimeout(timeout);
    currentPort?.close();
    currentPort = undefined;
    show("Reconnecting");
  }
  if (event.data?.kind !== "amun-port" || !event.ports[0]) return;
  currentPort?.close();
  clearTimeout(timeout);
  const port = event.ports[0];
  currentPort = port;
  const id = crypto.randomUUID();
  port.onmessage = (message) => {
    if (port !== currentPort) return;
    const response = healthResponse.safeParse(message.data);
    if (!response.success || response.data.id !== id) return;
    clearTimeout(timeout);
    show(response.data.status === "ready" ? "Connected" : "Reconnecting");
  };
  port.start();
  show("Connecting");
  timeout = setTimeout(() => show("Service unavailable"), 4000);
  port.postMessage(
    healthRequest.parse({ version: 1, id, method: "health", params: {} }),
  );
});
