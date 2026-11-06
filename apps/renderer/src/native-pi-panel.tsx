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
  const run = (value = argument) => {
    const id = crypto.randomUUID();
    pending.current = id;
    setBusy(true);
    setResult(null);
    bridge.send({
      version: 1,
      kind: "native-pi",
      action: "run",
      id,
      command,
      argument: value,
    });
  };
  if (!open)
    return <button onClick={() => setOpen(true)}>Open Pi commands</button>;
  return (
    <section aria-label="Pi commands">
      <h3>Pi session commands</h3>
      <p className="muted">
        This session belongs to Amun. Personal Pi sessions are separate. Empty
        sessions are saved after their first message.
      </p>
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
            "name",
            "copy",
            "compact",
            "reload",
          ].map((name) => (
            <option key={name} value={name}>
              /{name}
              {name === "copy" ? " — preview last reply" : ""}
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
          <p>{result.text}</p>
        ) : null}
      </div>
    </section>
  );
}
