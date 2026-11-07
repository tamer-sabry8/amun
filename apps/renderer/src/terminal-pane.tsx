import { terminalDocument } from "./terminal-document.ts";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { terminalEvent } from "@amun/contracts";
import "@xterm/xterm/css/xterm.css";
import { bridge } from "./bridge.ts";
export function TerminalPane({
  onClose,
  taskId,
}: {
  onClose(): void;
  taskId: string | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState("closed");
  useEffect(() => {
    if (!container.current) return;
    const terminal = new Terminal({
      documentOverride: terminalDocument(
        document,
        new URLSearchParams(location.search).get("styleNonce") ?? "",
      ),
      fontFamily: "JetBrains Mono, monospace",
      fontSize: 12,
      scrollback: 2000,
      disableStdin: true,
      theme: { background: "#0B0E14", foreground: "#F2F5F8" },
    });
    terminal.open(container.current);
    const unsubscribe = bridge.onEvent((input) => {
      if (
        input &&
        typeof input === "object" &&
        "kind" in input &&
        input.kind === "service-lost"
      ) {
        setState("unavailable");
        terminal.clear();
        return;
      }
      const parsed = terminalEvent.safeParse(input);
      if (!parsed.success) return;
      const event = parsed.data;
      if (event.kind === "terminal-data") terminal.write(event.data);
      else {
        setState(event.state);
        terminal.options.disableStdin = event.state !== "control";
      }
    });
    const input = terminal.onData((data) =>
      bridge.send({ version: 1, kind: "terminal", action: "input", data }),
    );
    const resize = () => {
      if (!container.current) return;
      const cols = Math.max(
        20,
        Math.min(300, Math.floor(container.current.clientWidth / 7.3)),
      );
      const rows = Math.max(
        5,
        Math.min(100, Math.floor(container.current.clientHeight / 15)),
      );
      terminal.resize(cols, rows);
      bridge.send({
        version: 1,
        kind: "terminal",
        action: "resize",
        cols,
        rows,
      });
    };
    bridge.send(
      taskId
        ? { version: 1, kind: "terminal", action: "attach-backend", taskId }
        : { version: 1, kind: "terminal", action: "open" },
    );
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    const timer = setTimeout(resize, 100);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      input.dispose();
      unsubscribe();
      bridge.send({ version: 1, kind: "terminal", action: "close" });
      terminal.dispose();
    };
  }, [taskId]);
  return (
    <section className="terminal-pane" aria-label="Terminal dock">
      <div className="terminal-toolbar">
        <strong>Terminal</strong>
        <span>{state}</span>
        <span className="muted">
          {taskId ? "Firstmate worker · " + taskId : "Isolated workspace shell"}
        </span>
        <button
          disabled={state !== "readonly" && state !== "control"}
          onClick={() =>
            bridge.send({
              version: 1,
              kind: "terminal",
              action: state === "control" ? "release-control" : "take-control",
            })
          }
        >
          {state === "control" ? "Return to read only" : "Take control"}
        </button>
        <button onClick={onClose}>Close terminal</button>
      </div>
      <div className="terminal-viewport" ref={container} />
    </section>
  );
}
