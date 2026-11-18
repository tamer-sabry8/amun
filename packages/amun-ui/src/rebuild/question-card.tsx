// The question card in a conversation: 2 to 4 choices with the recommended
// one highlighted, an inline "Write my own response" box, and, when a reply
// needs Azure DevOps that is not connected, "Connect to Azure now" with the
// sign-in right in the card. Approved by the owner on 18 November 2026.
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { bridge } from "../bridge.ts";

const WAITS = "Only the work that depends on this waits. Nothing is assumed.";

interface QuestionCardProps {
  title: string;
  detail?: string | null;
  options: string[];
  recommended: number | null;
  why: string | null;
  amber?: boolean;
  onAnswer(text: string): void;
}

/** A box for the owner's own words, with the cursor already in it. */
function OwnResponse({
  onSend,
  onBack,
}: {
  onSend(text: string): void;
  onBack(): void;
}) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => box.current?.focus(), []);
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim()) onSend(text.trim());
  };
  return (
    <form className="rb-own-response" onSubmit={send}>
      <label className="sr-only" htmlFor="own-response">
        Your answer to Firstmate
      </label>
      <textarea
        id="own-response"
        ref={box}
        rows={3}
        value={text}
        placeholder="Your answer to Firstmate"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) send(event);
          if (event.key === "Escape") onBack();
        }}
      />
      <div className="row wrap">
        <button className="btn primary" type="submit" disabled={!text.trim()}>
          Send answer
        </button>
        <button className="btn quiet" type="button" onClick={onBack}>
          Back to choices
        </button>
      </div>
    </form>
  );
}

function Recommendation({
  label,
  why,
}: {
  label: string | null;
  why: string | null;
}) {
  if (!label) return null;
  return (
    <span className="rb-why">
      Firstmate recommends <strong>{label}</strong>
      {why ? `: ${why}` : "."}
    </span>
  );
}

export function QuestionCard({
  title,
  detail,
  options,
  recommended,
  why,
  amber,
  onAnswer,
}: QuestionCardProps) {
  const [writing, setWriting] = useState(false);
  const choices = options.slice(0, 4);
  return (
    <div
      className={"rb-inline" + (amber ? " amber" : "")}
      role="group"
      aria-label="Question from Firstmate"
    >
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
      {writing ? (
        <OwnResponse
          onSend={(text) => {
            setWriting(false);
            onAnswer(text);
          }}
          onBack={() => setWriting(false)}
        />
      ) : (
        <>
          <div className="row wrap">
            {choices.map((option, index) => (
              <button
                key={option}
                className={"btn" + (index === recommended ? " primary" : "")}
                onClick={() => onAnswer(option)}
              >
                {option}
              </button>
            ))}
            <button className="btn quiet" onClick={() => setWriting(true)}>
              Write my own response
            </button>
          </div>
          <Recommendation
            label={recommended === null ? null : (choices[recommended] ?? null)}
            why={why}
          />
        </>
      )}
      <span className="note">{WAITS}</span>
    </div>
  );
}

/** Whether a working Azure DevOps connection is saved. */
export function useAzureConnected(): boolean {
  const state = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
  return state.connections.some(
    (connection) => connection.kind === "ado" && connection.status === "ready",
  );
}

function ConnectForm({ onCancel }: { onCancel(): void }) {
  const state = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
  const [baseUrl, setBaseUrl] = useState("");
  const [sentNotice, setSentNotice] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const token = useRef<HTMLInputElement>(null);
  const address = useRef<HTMLInputElement>(null);
  useEffect(() => address.current?.focus(), []);
  // The daemon answers with a notice: who the token signs in as, or why not.
  const answer =
    checking && state.notice && state.notice !== sentNotice
      ? state.notice
      : null;
  useEffect(() => {
    if (answer) setChecking(false);
  }, [answer]);
  const connect = (event: FormEvent) => {
    event.preventDefault();
    const secret = token.current?.value ?? "";
    if (!secret || !baseUrl) return;
    if (token.current) token.current.value = "";
    setSentNotice(state.notice);
    setChecking(true);
    bridge.send({
      version: 1,
      kind: "auth",
      action: "save",
      connection: { kind: "ado", baseUrl },
      secret,
    });
  };
  const failed =
    !checking && sentNotice !== null && state.notice !== sentNotice
      ? state.notice
      : null;
  return (
    <form className="rb-inline-form" onSubmit={connect}>
      <label className="field">
        Collection address
        <input
          ref={address}
          type="url"
          required
          value={baseUrl}
          placeholder="https://devops.example.com/YourCollection/"
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </label>
      <label className="field">
        Personal access token
        <input
          ref={token}
          type="password"
          required
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {failed && (
        <span className="rb-notice error" role="alert">
          {failed}
        </span>
      )}
      <div className="row wrap">
        <button className="btn primary" type="submit" disabled={checking}>
          {checking ? "Checking…" : "Connect"}
        </button>
        <button className="btn quiet" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <span className="note">
        Amun checks the token with your server before saving it. It’s kept in
        your Mac’s Keychain, never in a file.
      </span>
    </form>
  );
}

/**
 * Shown when the First Mate's reply needs Azure DevOps and it is not
 * connected. Once a check passes, the card says what the token can read.
 */
export function AzureConnectCard({
  product,
  onDismiss,
  onAnswer,
}: {
  product: string;
  onDismiss(): void;
  onAnswer(text: string): void;
}) {
  const state = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot);
  const connected = useAzureConnected();
  const [mode, setMode] = useState<"ask" | "connect" | "own">("ask");
  if (connected)
    return (
      <div className="rb-inline" role="status">
        <span>{state.notice || "Azure DevOps is connected."}</span>
      </div>
    );
  return (
    <div
      className="rb-inline amber"
      role="group"
      aria-label="Connect Azure DevOps"
    >
      <strong>
        {mode === "connect"
          ? "Connect Azure DevOps"
          : "Azure DevOps isn’t connected. Would you like to connect it?"}
      </strong>
      {mode === "connect" ? (
        <ConnectForm onCancel={() => setMode("ask")} />
      ) : mode === "own" ? (
        <OwnResponse
          onSend={(text) => {
            setMode("ask");
            onAnswer(text);
          }}
          onBack={() => setMode("ask")}
        />
      ) : (
        <>
          <span>
            {product} needs your latest stories and sprints. Once it’s
            connected, Firstmate can read them.
          </span>
          <div className="row wrap">
            <button className="btn primary" onClick={() => setMode("connect")}>
              Connect to Azure now
            </button>
            <button className="btn" onClick={onDismiss}>
              Not now
            </button>
            <button className="btn quiet" onClick={() => setMode("own")}>
              Write my own response
            </button>
          </div>
          <Recommendation
            label="Connect to Azure now"
            why="nothing on this product can read your backlog until it’s connected"
          />
        </>
      )}
      {mode !== "connect" && <span className="note">{WAITS}</span>}
    </div>
  );
}
