// Firstmate's built-in skills (/afk, /quiet, /ahoy, /bearings, /updatefirstmate,
// /stow, /calm, /supervision-model) from the new composer. They go to
// Firstmate over the same bridge message as the earlier Pi panel, never to
// crew, and the reply shows as a Firstmate message.
import { useEffect, useRef, useState } from "react";
import { nativePiEvent, type NativePiEvent } from "@amun/contracts";
import { bridge } from "../bridge.ts";
import { firstmateCommand } from "../composer-command.ts";
import { FirstmateMark } from "./firstmate-mark.tsx";
import { MarkdownMessage } from "./markdown-doc.tsx";

type Result = NativePiEvent["result"];

export function useFirstmateCommands() {
  const request = useRef<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(
    () =>
      bridge.onEvent((value) => {
        const event = nativePiEvent.safeParse(value);
        if (event.success && event.data.id === request.current) {
          request.current = null;
          setBusy(false);
          setResult(event.data.result);
        } else if (
          request.current &&
          value &&
          typeof value === "object" &&
          "kind" in value &&
          value.kind === "service-lost"
        ) {
          request.current = null;
          setBusy(false);
          setResult({
            kind: "message",
            text: "Firstmate lost its connection. Reopen the view to reconnect.",
          });
        }
      }),
    [],
  );
  const run = (name: string, argument: string) => {
    const id = crypto.randomUUID();
    request.current = id;
    setBusy(true);
    setResult(null);
    bridge.send({
      version: 1,
      kind: "native-pi",
      action: "run",
      id,
      command: name,
      argument,
    });
  };
  /** True when the text was a Firstmate skill and has been sent. */
  const send = (text: string) => {
    const parsed = firstmateCommand(text);
    if (!parsed || request.current) return false;
    run(parsed.name, parsed.argument);
    return true;
  };
  /** Shows the answer of a command Amun carried out itself (/model, /theme). */
  const answer = (work: Promise<string>) => {
    request.current = null;
    setBusy(true);
    setResult(null);
    void work
      .catch(() => "That did not work. Try again.")
      .then((text) => {
        setBusy(false);
        setResult({ kind: "message", text });
      });
  };
  return { send, run, answer, result, busy, clear: () => setResult(null) };
}

export function FirstmateCommandReply({
  state,
  onBoard,
}: {
  state: ReturnType<typeof useFirstmateCommands>;
  onBoard?: ((url: string) => void) | undefined;
}) {
  const { result, busy, run, clear } = state;
  let body: React.ReactNode = null;
  if (busy) body = <span className="muted small">Working on it…</span>;
  else if (result?.kind === "stow-review")
    body = (
      <>
        <p style={{ whiteSpace: "pre-wrap" }}>{result.text}</p>
        {result.pins.map((pin) => (
          <div key={pin.id} role="group" aria-label={pin.proposed}>
            <p className="small">
              <strong>{pin.file}</strong>
            </p>
            <p className="muted small">{pin.previous}</p>
            <p className="small">{pin.proposed}</p>
            <div className="rb-inline">
              <button
                className="btn"
                onClick={() => run("stow", "approve " + pin.id)}
              >
                Apply this change
              </button>
              <button
                className="btn quiet"
                onClick={() => run("stow", "keep " + pin.id)}
              >
                Keep what is there
              </button>
            </div>
          </div>
        ))}
      </>
    );
  else if (result?.kind === "bearings-board")
    body = (
      <>
        <p style={{ whiteSpace: "pre-wrap" }}>{result.text}</p>
        {onBoard && (
          <button className="btn" onClick={() => onBoard(result.url)}>
            Open the board
          </button>
        )}
      </>
    );
  else if (result?.kind === "message" || result?.kind === "copy")
    body = <MarkdownMessage text={result.text} />;
  else if (result?.kind === "conversation")
    body = <MarkdownMessage text={result.text} />;
  else if (result) body = <p>Done.</p>;
  return (
    <div aria-live="polite" data-testid="firstmate-command-reply">
      {body && (
        <div className="rb-msg firstmate" style={{ marginBottom: 12 }}>
          <span className="who">
            <FirstmateMark size={18} />
            Firstmate
          </span>
          {body}
          {!busy && (
            <button className="link small" onClick={clear}>
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
