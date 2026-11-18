// Settings › Advanced in the new shell: the Firstmate runtime controls and
// the conversation tools. They send the same bridge messages as the earlier
// agents and Pi panels, with the same review and confirmation steps.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  diagnosticsResult,
  nativePiEvent,
  type NativePiEvent,
} from "@amun/contracts";
import { bridge } from "../bridge.ts";

type Result = NativePiEvent["result"];

const statLabels: Record<string, string> = {
  userMessages: "Your messages",
  assistantMessages: "Firstmate replies",
  toolCalls: "Tool uses",
  toolResults: "Tool results",
  totalCost: "Total cost",
};

function useConnected() {
  const { generation, status } = useSyncExternalStore(
    bridge.subscribe,
    bridge.getSnapshot,
  );
  return { generation, connected: status === "Connected" && !!generation };
}

export function FirstmateRuntime() {
  const { generation, connected } = useConnected();
  const request = useRef<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [charter, setCharter] = useState("");
  const send = (command: string, argument: string) => {
    if (request.current) return;
    const id = crypto.randomUUID();
    request.current = id;
    setBusy(true);
    bridge.send({
      version: 1,
      kind: "native-pi",
      action: "run",
      command,
      argument,
      id,
    });
  };
  const release = (argument: "status" | "prepare" | "rollback" | "crew-home") =>
    send("firstmate-release", argument);
  useEffect(() => {
    request.current = null;
    setStatus("");
    setBusy(false);
    if (!connected) return;
    const off = bridge.onEvent((value) => {
      const event = nativePiEvent.safeParse(value);
      if (
        event.success &&
        event.data.kind === "native-pi-result" &&
        event.data.id === request.current &&
        event.data.result.kind === "message"
      ) {
        request.current = null;
        setBusy(false);
        setStatus(event.data.result.text);
        if (/^Firstmate (dispatched|recovered)/.test(event.data.result.text))
          bridge.send({ version: 1, kind: "crew-list" });
      }
    });
    release("status");
    return off;
  }, [generation, connected]);
  return (
    <section aria-labelledby="rb-adv-runtime">
      <h3 id="rb-adv-runtime">Firstmate runtime</h3>
      <p className="muted">
        Choose the version of Firstmate used for new work folders. Crew already
        at work keep theirs.
      </p>
      <div className="rb-inline">
        <span className="row wrap">
          <button
            className="btn quiet"
            disabled={!connected || busy}
            onClick={() => release("crew-home")}
          >
            Open the crew home
          </button>
          <button
            className="btn quiet"
            disabled={!connected || busy}
            onClick={() => release("prepare")}
          >
            Prepare a Firstmate work folder
          </button>
          <button
            className="btn quiet"
            disabled={!connected || busy}
            onClick={() => release("rollback")}
          >
            Go back to the previous Firstmate
          </button>
        </span>
        <label className="field">
          Crew tool
          <select disabled value="pi" aria-readonly="true">
            <option value="pi">GitHub Copilot (Pi) · Claude Sonnet 5.5</option>
          </select>
        </label>
        <label className="field">
          What the crewmate should do
          <textarea
            value={charter}
            maxLength={2000}
            rows={3}
            disabled={busy}
            onChange={(event) => setCharter(event.target.value)}
          />
        </label>
        <span className="row">
          <button
            className="btn"
            disabled={!connected || busy || !charter.trim()}
            onClick={() =>
              send("crew-dispatch", JSON.stringify({ harness: "pi", charter }))
            }
          >
            Ask Firstmate to dispatch
          </button>
        </span>
        <p className="small" role="status" aria-live="polite">
          {busy ? "Checking Firstmate…" : status}
        </p>
      </div>
    </section>
  );
}

export function ConversationTools() {
  const { connected } = useConnected();
  const pending = useRef<string | null>(null);
  const exportPending = useRef<string | null>(null);
  const importFile = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [format, setFormat] = useState("html");
  const [exportStatus, setExportStatus] = useState("");
  useEffect(() => {
    const off = bridge.onEvent((value) => {
      const event = nativePiEvent.safeParse(value);
      if (event.success && event.data.id === pending.current) {
        if (
          event.data.result.kind === "turn-queue" ||
          event.data.result.kind === "extension-dialog"
        )
          return;
        pending.current = null;
        setBusy(false);
        setResult(event.data.result);
      } else if (
        value &&
        typeof value === "object" &&
        "kind" in value &&
        value.kind === "service-lost" &&
        pending.current
      ) {
        pending.current = null;
        setBusy(false);
        setResult({
          kind: "message",
          text: "The connection to Amun was lost. Try again in a moment.",
        });
      }
    });
    const listener = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.data?.kind !== "amun-pi-export-status" ||
        !exportPending.current ||
        event.data.result?.id !== exportPending.current
      )
        return;
      exportPending.current = null;
      setExportStatus(
        event.data.result.status === "saved"
          ? "Export saved"
          : event.data.result.status === "cancelled"
            ? "Export cancelled"
            : "Export not saved. Choose a new file name; existing files are not overwritten.",
      );
    };
    window.addEventListener("message", listener);
    return () => {
      off();
      window.removeEventListener("message", listener);
    };
  }, []);
  const run = (command: string, argument = "") => {
    const id = crypto.randomUUID();
    pending.current = id;
    setBusy(true);
    setResult(null);
    setExportStatus("");
    bridge.send({
      version: 1,
      kind: "native-pi",
      action: "run",
      id,
      command,
      argument,
    });
  };
  const disabled = !connected || busy;
  return (
    <section aria-labelledby="rb-adv-tools">
      <h3 id="rb-adv-tools">Conversation tools</h3>
      <p className="muted">
        These work on the conversation you have open with Firstmate.
      </p>
      <div className="rb-inline">
        <span className="row wrap">
          <button
            className="btn quiet"
            disabled={disabled}
            onClick={() => importFile.current?.click()}
          >
            Import a session
          </button>
          <button
            className="btn quiet"
            disabled={disabled}
            onClick={() => run("session")}
          >
            Show session numbers
          </button>
        </span>
        <input
          ref={importFile}
          hidden
          type="file"
          aria-label="Session file to import (up to 512 KiB)"
          accept=".jsonl,application/jsonl"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            if (file.size > 524288) {
              setResult({
                kind: "message",
                text: "That file is over 512 KiB, which is too large to review.",
              });
              return;
            }
            try {
              run("import-preview", await file.text());
            } catch {
              setResult({
                kind: "message",
                text: "Could not read that session file.",
              });
            }
          }}
        />
        <span className="row wrap">
          <label className="field">
            Save the conversation as
            <select
              value={format}
              disabled={disabled}
              onChange={(event) => setFormat(event.target.value)}
            >
              <option value="html">Web page (HTML)</option>
              <option value="jsonl">Data file (JSONL)</option>
            </select>
          </label>
          <button
            className="btn quiet"
            disabled={disabled}
            onClick={() => run("export", format)}
          >
            Review export
          </button>
        </span>
        <span className="row wrap">
          <button
            className="btn quiet"
            disabled={disabled}
            onClick={() => run("model")}
          >
            Choose a model
          </button>
          <button
            className="btn quiet"
            disabled={disabled}
            onClick={() => run("cycle-model", "backward")}
          >
            Previous model
          </button>
          <button
            className="btn quiet"
            disabled={disabled}
            onClick={() => run("cycle-model", "forward")}
          >
            Next model
          </button>
          <button
            className="btn quiet"
            disabled={disabled}
            onClick={() => run("thinking")}
          >
            Choose how much it thinks
          </button>
          <button
            className="btn quiet"
            disabled={disabled}
            onClick={() => run("cycle-thinking")}
          >
            Next thinking level
          </button>
        </span>
        <div aria-live="polite" style={{ display: "grid", gap: 10 }}>
          {busy && <p className="small">Working…</p>}
          {result?.kind === "message" && <p className="small">{result.text}</p>}
          {result?.kind === "stats" && (
            <dl className="small">
              {result.values.map((value) => (
                <div key={value.label} className="row">
                  <dt>{statLabels[value.label] ?? value.label}:</dt>
                  <dd>{value.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {result?.kind === "choices" && (
            <div>
              <strong>{result.title}</strong>
              <ul
                className="plain-list"
                style={{ listStyle: "none", padding: 0 }}
              >
                {result.choices.map((choice) => (
                  <li key={choice.id}>
                    <button
                      className="btn quiet"
                      disabled={busy}
                      onClick={() =>
                        run(
                          result.title === "Thinking level"
                            ? "thinking"
                            : "model",
                          choice.id,
                        )
                      }
                    >
                      {choice.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result?.kind === "import-review" && (
            <div style={{ display: "grid", gap: 8 }}>
              <strong>Review before importing</strong>
              <p className="small">
                {result.entries} entries · session{" "}
                <code>{result.sessionId}</code>
              </p>
              <p className="small">
                It was started in <code>{result.originalCwd}</code>. Amun will
                keep the copy in its own folder instead:{" "}
                <code>{result.targetCwd}</code>
              </p>
              <p className="note">
                Your original file is not changed. Imported text can contain
                private details. Nothing is sent to a model or run during
                import.
              </p>
              {result.removedParent && (
                <p className="note">
                  The link to the session this one branched from will be left
                  out of the copy.
                </p>
              )}
              <span className="row wrap">
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => run("import", result.token)}
                >
                  Import into Amun
                </button>
                <button
                  className="btn quiet"
                  disabled={busy}
                  onClick={() => setResult(null)}
                >
                  Cancel
                </button>
              </span>
            </div>
          )}
          {result?.kind === "export" && (
            <div style={{ display: "grid", gap: 8 }}>
              <strong>Review the {result.format.toUpperCase()} export</strong>
              <p className="note">
                Conversations can contain prompts, file contents and secrets.
                Read this before you save or share it.
              </p>
              <label className="field">
                Export contents
                <textarea
                  readOnly
                  rows={10}
                  value={result.review}
                  aria-label="Export contents to review"
                />
              </label>
              <span className="row wrap">
                <button
                  className="btn"
                  onClick={() => {
                    const id = crypto.randomUUID();
                    exportPending.current = id;
                    setExportStatus("Choose where to save it…");
                    window.postMessage(
                      {
                        kind: "amun-pi-export-command",
                        command: {
                          id,
                          format: result.format,
                          text: result.text,
                        },
                      },
                      "*",
                    );
                  }}
                >
                  Save the reviewed export…
                </button>
                <button className="btn quiet" onClick={() => setResult(null)}>
                  Close
                </button>
              </span>
            </div>
          )}
          {exportStatus && <p className="small">{exportStatus}</p>}
        </div>
      </div>
    </section>
  );
}

export function DiagnosticsTools() {
  const { connected } = useConnected();
  const pending = useRef<string | null>(null);
  const savePending = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => {
    const off = bridge.onEvent((value) => {
      const result = diagnosticsResult.safeParse(value);
      if (result.success && result.data.id === pending.current) {
        pending.current = null;
        setBusy(false);
        setReview(result.data.text);
        setStatus("");
      } else if (
        value &&
        typeof value === "object" &&
        "kind" in value &&
        value.kind === "service-lost" &&
        pending.current
      ) {
        pending.current = null;
        setBusy(false);
        setStatus("The connection to Amun was lost. Try again in a moment.");
      }
    });
    const listener = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.data?.kind !== "amun-pi-export-status" ||
        !savePending.current ||
        event.data.result?.id !== savePending.current
      )
        return;
      savePending.current = null;
      setStatus(
        event.data.result.status === "saved"
          ? "Diagnostics saved"
          : event.data.result.status === "cancelled"
            ? "Export cancelled"
            : "Diagnostics not saved. Choose a new file name; existing files are not overwritten.",
      );
    };
    window.addEventListener("message", listener);
    return () => {
      off();
      window.removeEventListener("message", listener);
    };
  }, []);
  return (
    <section aria-labelledby="rb-adv-diag">
      <h3 id="rb-adv-diag">Diagnostics</h3>
      <p className="muted">
        Save recent Amun logs and version numbers to help find a problem.
      </p>
      <div className="rb-inline">
        <span className="row wrap">
          <button
            className="btn quiet"
            disabled={!connected || busy}
            onClick={() => {
              const id = crypto.randomUUID();
              pending.current = id;
              setBusy(true);
              setReview(null);
              setStatus("");
              bridge.send({ version: 1, kind: "diagnostics", id });
            }}
          >
            Export diagnostics
          </button>
        </span>
        <div aria-live="polite" style={{ display: "grid", gap: 10 }}>
          {busy && <p className="small">Working…</p>}
          {review !== null && (
            <div style={{ display: "grid", gap: 8 }}>
              <strong>Review the diagnostics</strong>
              <p className="note">
                Sign-ins and secrets are removed, but read this before you save
                or share it. Nothing leaves this Mac.
              </p>
              <label className="field">
                Diagnostics contents
                <textarea
                  readOnly
                  rows={10}
                  value={review}
                  aria-label="Diagnostics contents to review"
                />
              </label>
              <span className="row wrap">
                <button
                  className="btn"
                  onClick={() => {
                    const id = crypto.randomUUID();
                    savePending.current = id;
                    setStatus("Choose where to save it…");
                    window.postMessage(
                      {
                        kind: "amun-pi-export-command",
                        command: { id, format: "txt", text: review },
                      },
                      "*",
                    );
                  }}
                >
                  Save the reviewed diagnostics…
                </button>
                <button className="btn quiet" onClick={() => setReview(null)}>
                  Close
                </button>
              </span>
            </div>
          )}
          {status && <p className="small">{status}</p>}
        </div>
      </div>
    </section>
  );
}
