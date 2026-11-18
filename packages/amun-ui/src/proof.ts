import { terminalDocument } from "./terminal-document.ts";
import { resetServiceUI } from "./service-loss.js";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { piEvent, terminalEvent, crewObservation } from "@amun/contracts";
import { healthRequest, healthResponse } from "@amun/contracts";

export function startProof() {
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
      resetServiceUI((id) => document.getElementById(id), terminal);
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
      const crewMessage = crewObservation.safeParse(message.data);
      if (crewMessage.success) {
        const label = document.getElementById("crew-observation");
        if (label)
          label.textContent = `${crewMessage.data.taskId}: endpoint ${crewMessage.data.endpoint}; worker ${crewMessage.data.worker}`;
        const runLabel = document.getElementById("crew-run");
        const run = crewMessage.data.run;
        if (runLabel)
          runLabel.textContent = run
            ? `${run.harness} | ${run.branch} | ${run.worktree} | model ${run.model} | ${run.state}`
            : "unknown";
        return;
      }
      const piMessage = piEvent.safeParse(message.data);
      if (piMessage.success) {
        const event = piMessage.data;
        if (event.kind === "pi-state") {
          const label = document.getElementById("pi-status");
          if (label) label.textContent = event.state;
          if (event.state === "closed" || event.state === "unavailable")
            document.getElementById("pi-dialog")?.replaceChildren();
        } else if (event.kind === "pi-models") {
          const label = document.getElementById("pi-models");
          if (label)
            label.textContent =
              `${event.models.length} available models: ` +
              event.models
                .map((model) => model.provider + "/" + model.id)
                .join(", ")
                .slice(0, 4096);
        } else if (event.kind === "pi-text") {
          const output = document.getElementById("pi-output");
          if (output)
            output.textContent = (
              (output.textContent ?? "") + event.text
            ).slice(-262144);
        } else {
          const dialog = document.getElementById("pi-dialog");
          if (!dialog) return;
          dialog.replaceChildren();
          const title = document.createElement("p");
          title.textContent = event.title;
          dialog.append(title);
          if (event.message) {
            const text = document.createElement("p");
            text.textContent = event.message;
            dialog.append(text);
          }
          const answers: (string | boolean | null)[] =
            event.method === "select"
              ? [...(event.options ?? []), null]
              : [true, false, null];
          for (const answer of answers) {
            const button = document.createElement("button");
            button.textContent =
              answer === null
                ? "Cancel"
                : answer === true
                  ? "Yes"
                  : answer === false
                    ? "No"
                    : answer;
            button.addEventListener("click", () => {
              port.postMessage({
                version: 1,
                kind: "pi",
                action: "answer",
                id: event.id,
                answer,
              });
              dialog.replaceChildren();
            });
            dialog.append(button);
          }
        }
        return;
      }
      const terminalMessage = terminalEvent.safeParse(message.data);
      if (terminalMessage.success) {
        const event = terminalMessage.data;
        if (event.kind === "terminal-data") {
          terminal.write(event.data);
          const output = document.getElementById("terminal-output");
          if (output)
            output.textContent = (
              (output.textContent ?? "") + event.data
            ).slice(-65536);
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

  document
    .getElementById("browser-form")
    ?.addEventListener("submit", (event) => {
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
    documentOverride: terminalDocument(
      document,
      new URLSearchParams(location.search).get("styleNonce") ?? "",
    ),
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

  for (const [id, action] of [
    ["pi-open", "open-protocol"],
    ["pi-close", "close"],
  ])
    document
      .getElementById(id!)
      ?.addEventListener("click", () =>
        currentPort?.postMessage({ version: 1, kind: "pi", action }),
      );
  document.getElementById("pi-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("pi-prompt") as HTMLInputElement;
    currentPort?.postMessage({
      version: 1,
      kind: "pi",
      action: "prompt",
      message: input.value,
    });
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-pi-provider]",
  ))
    button.addEventListener("click", () => {
      const output = document.getElementById("pi-output");
      if (output) output.textContent = "";
      currentPort?.postMessage({
        version: 1,
        kind: "pi",
        action: "open-provider",
        provider: button.dataset.piProvider,
      });
    });

  document.getElementById("observe-crew")?.addEventListener("click", () => {
    const taskId = (document.getElementById("crew-task") as HTMLInputElement)
      ?.value;
    currentPort?.postMessage({ version: 1, kind: "crew-observe", taskId });
  });

  document.getElementById("attach-backend")?.addEventListener("click", () => {
    const taskId = (document.getElementById("crew-task") as HTMLInputElement)
      ?.value;
    window.postMessage(
      { kind: "amun-browser-command", command: { action: "close" } },
      "*",
    );
    if (dock) dock.hidden = false;
    terminal.clear();
    const output = document.getElementById("terminal-output");
    if (output) output.textContent = "";
    currentPort?.postMessage({
      version: 1,
      kind: "terminal",
      action: "attach-backend",
      taskId,
    });
  });

  let handoffId: string | undefined;
  const handoffPanel = document.getElementById("browser-handoff");
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.kind !== "amun-browser-handoff")
      return;
    const data = event.data.handoff;
    handoffId =
      data &&
      typeof data.id === "string" &&
      data.id.length <= 128 &&
      typeof data.host === "string" &&
      data.host.length <= 300
        ? data.id
        : undefined;
    if (handoffPanel) handoffPanel.hidden = !handoffId;
    const host = document.getElementById("handoff-host");
    if (host) host.textContent = handoffId ? data.host : "";
  });
  for (const target of ["chrome", "default"])
    document
      .getElementById("handoff-" + target)
      ?.addEventListener("click", () => {
        if (handoffId)
          window.postMessage(
            {
              kind: "amun-browser-command",
              command: { action: "handoff", id: handoffId, target },
            },
            "*",
          );
      });
  document.getElementById("handoff-dismiss")?.addEventListener("click", () => {
    handoffId = undefined;
    if (handoffPanel) handoffPanel.hidden = true;
  });
}
