import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { terminalEvent } from "@amun/contracts";
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
    const terminalMessage = terminalEvent.safeParse(message.data);
    if (terminalMessage.success) {
      const event = terminalMessage.data;
      if (event.kind === "terminal-data") {
        terminal.write(event.data);
        const output = document.getElementById("terminal-output");
        if (output)
          output.textContent = ((output.textContent ?? "") + event.data).slice(
            -65536,
          );
      } else {
        const label = document.getElementById("terminal-status");
        if (label) label.textContent = event.state;
        terminal.options.disableStdin = event.state !== "control";
      }
      return;
    }
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

document.getElementById("browser-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.getElementById("browser-url") as HTMLInputElement;
  window.postMessage(
    {
      kind: "amun-browser-command",
      command: { action: "navigate", url: input.value },
    },
    "*",
  );
});
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-browser]",
)) {
  button.addEventListener("click", () =>
    window.postMessage(
      {
        kind: "amun-browser-command",
        command: { action: button.dataset.browser },
      },
      "*",
    ),
  );
}
window.addEventListener("message", (event) => {
  if (
    event.source !== window ||
    event.data?.kind !== "amun-browser-status" ||
    typeof event.data.message !== "string"
  )
    return;
  const status = document.getElementById("browser-status");
  if (status) status.textContent = event.data.message;
});

const terminal = new Terminal({
  cols: 80,
  rows: 24,
  scrollback: 1000,
  disableStdin: true,
  allowProposedApi: false,
});
const dock = document.getElementById("terminal-dock");
if (dock) terminal.open(dock);
terminal.onData((data) =>
  currentPort?.postMessage({
    version: 1,
    kind: "terminal",
    action: "input",
    data,
  }),
);
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-terminal]",
)) {
  button.addEventListener("click", () => {
    const action = button.dataset.terminal;
    if (action === "open")
      window.postMessage(
        { kind: "amun-browser-command", command: { action: "close" } },
        "*",
      );
    if (dock && action === "open") dock.hidden = false;
    if (dock && action === "close") dock.hidden = true;
    if (action === "resize") {
      terminal.resize(100, 30);
      currentPort?.postMessage({
        version: 1,
        kind: "terminal",
        action,
        cols: 100,
        rows: 30,
      });
    } else currentPort?.postMessage({ version: 1, kind: "terminal", action });
  });
}
