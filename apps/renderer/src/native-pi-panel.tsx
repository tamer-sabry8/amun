import { useEffect, useRef, useState } from "react";
import { nativePiEvent, type NativePiEvent } from "@amun/contracts";
import { bridge } from "./bridge.ts";
export function NativePiPanel() {
  const [open, setOpen] = useState(false),
    [command, setCommand] = useState("session"),
    [argument, setArgument] = useState(""),
    [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NativePiEvent["result"] | null>(null);
  const pending = useRef<string | null>(null);
  const copyPending = useRef<string | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.data?.kind !== "amun-pi-clipboard-status" ||
        event.data.result?.id !== copyPending.current ||
        !copyPending.current
      )
        return;
      copyPending.current = null;
      setCopyStatus(
        event.data.result.ok === true
          ? "Copied to clipboard"
          : "Clipboard copy failed",
      );
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  useEffect(
    () =>
      bridge.onEvent((value) => {
        const event = nativePiEvent.safeParse(value);
        if (event.success && event.data.id === pending.current) {
          pending.current = null;
          setBusy(false);
          setResult(event.data.result);
        } else if (
          value &&
          typeof value === "object" &&
          "kind" in value &&
          value.kind === "service-lost"
        ) {
          pending.current = null;
          setBusy(false);
          setResult({
            kind: "message",
            text: "Session connection lost. Reopen the view to reconnect.",
          });
        }
      }),
    [],
  );
  useEffect(
    () => () => {
      bridge.send({ version: 1, kind: "native-pi", action: "close" });
    },
    [],
  );
  const run = (value = argument, selectedCommand = command) => {
    if (selectedCommand === "quit") {
      bridge.send({ version: 1, kind: "native-pi", action: "close" });
      setOpen(false);
      setResult(null);
      return;
    }
    const id = crypto.randomUUID();
    pending.current = id;
    setBusy(true);
    setResult(null);
    setCopyStatus("");
    bridge.send({
      version: 1,
      kind: "native-pi",
      action: "run",
      id,
      command: selectedCommand,
      argument: value,
    });
  };
  if (!open)
    return <button onClick={() => setOpen(true)}>Open Pi commands</button>;
  return (
    <section
      aria-label="Pi commands"
      onKeyDown={(event) => {
        if (
          event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          event.key.toLowerCase() === "p"
        ) {
          event.preventDefault();
          if (!busy)
            run(event.shiftKey ? "backward" : "forward", "cycle-model");
        }
      }}
    >
      <h3>Pi session commands</h3>
      <p className="muted">
        This session belongs to Amun. Personal Pi sessions are separate. Empty
        sessions are saved after their first message.
      </p>
      <h4>CLI subscriptions</h4>
      <p className="muted">
        These checks use your separate Amun CLI profiles. Pi model-provider
        authorization is managed above. Inference checks send a small test
        request to your subscription.
      </p>
      <div className="button-row">
        {(["codex", "claude"] as const).map((tool) => (
          <div key={tool}>
            <button disabled={busy} onClick={() => run(tool, "worker-status")}>
              Check {tool === "codex" ? "Codex" : "Claude Code"} subscription
            </button>
            <button
              disabled={busy}
              onClick={() => run(tool, "worker-inference")}
            >
              Verify {tool === "codex" ? "Codex" : "Claude Code"} inference
            </button>
          </div>
        ))}
      </div>
      <label>
        Native Pi command
        <select
          aria-label="Native Pi command"
          value={command}
          disabled={busy}
          onChange={(event) => {
            setCommand(event.target.value);
            setArgument("");
            setResult(null);
          }}
        >
          {[
            "session",
            "new",
            "resume",
            "fork",
            "clone",
            "tree",
            "model",
            "thinking",
            "scoped-models",
            "name",
            "copy",
            "compact",
            "reload",
            "quit",
          ].map((name) => (
            <option key={name} value={name}>
              /{name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Command argument
        <input
          value={argument}
          maxLength={16384}
          disabled={busy}
          onChange={(event) => setArgument(event.target.value)}
        />
      </label>
      <div className="button-row">
        <button disabled={busy} onClick={() => run("backward", "cycle-model")}>
          Previous model
        </button>
        <button disabled={busy} onClick={() => run("forward", "cycle-model")}>
          Next model
        </button>
        <button disabled={busy} onClick={() => run()}>
          Run command
        </button>
        <button
          onClick={() => {
            bridge.send({ version: 1, kind: "native-pi", action: "close" });
            pending.current = null;
            setBusy(false);
            setOpen(false);
          }}
        >
          Close Pi commands
        </button>
      </div>
      <div data-testid="native-pi-result" aria-live="polite">
        {busy ? "Working…" : null}
        {result?.kind === "choices" ? (
          <>
            <h4>{result.title}</h4>
            <ul className="plain-list">
              {result.choices.map((choice) => (
                <li key={choice.id}>
                  <button onClick={() => run(choice.id)}>{choice.label}</button>
                </li>
              ))}
            </ul>
          </>
        ) : result?.kind === "stats" ? (
          <dl>
            {result.values.map((value) => (
              <div key={value.label}>
                <dt>{value.label}</dt>
                <dd>{value.value}</dd>
              </div>
            ))}
          </dl>
        ) : result ? (
          <>
            <p>
              {result.text ||
                (result.kind === "copy" ? "No assistant reply to copy" : "")}
            </p>
            {result.kind === "copy" && result.text ? (
              <button
                onClick={() => {
                  const id = crypto.randomUUID();
                  copyPending.current = id;
                  setCopyStatus("Copying…");
                  window.postMessage(
                    {
                      kind: "amun-pi-clipboard-command",
                      command: { action: "copy", id, text: result.text },
                    },
                    "*",
                  );
                }}
              >
                Copy reply to clipboard
              </button>
            ) : null}
            <p role="status">{copyStatus}</p>
          </>
        ) : null}
      </div>
    </section>
  );
}
