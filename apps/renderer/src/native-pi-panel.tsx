import { useEffect, useRef, useState } from "react";
import { nativePiEvent, type NativePiEvent } from "@amun/contracts";
import { bridge } from "./bridge.ts";
export function NativePiPanel() {
  const [open, setOpen] = useState(false),
    [command, setCommand] = useState("session"),
    [argument, setArgument] = useState(""),
    [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NativePiEvent["result"] | null>(null);
  const [loginStatus, setLoginStatus] = useState("");
  const [loginPending, setLoginPending] = useState(false);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.data?.kind !== "amun-worker-login-status" ||
        !["codex", "claude"].includes(event.data.result?.tool)
      )
        return;
      setLoginPending(false);
      setLoginStatus(
        event.data.result.status === "opened"
          ? "Official CLI sign-in opened in Terminal. Complete any Microsoft Edge authorization there, then check the subscription below. Opening Terminal does not confirm sign-in."
          : "The official sign-in window could not open. Your existing profile is unchanged.",
      );
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  const pending = useRef<string | null>(null);
  const copyPending = useRef<string | null>(null);
  const exportPending = useRef<string | null>(null);
  const [exportStatus, setExportStatus] = useState("");
  useEffect(() => {
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
    return () => window.removeEventListener("message", listener);
  }, []);
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
    if (selectedCommand !== "settings" || result?.kind !== "preferences")
      setResult(null);
    setCopyStatus("");
    copyPending.current = null;
    exportPending.current = null;
    setExportStatus("");
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
      <div className="button-row">
        <button disabled={busy} onClick={() => run("", "share-notion")}>
          Share to Notion
        </button>
      </div>
      <p className="muted">
        Notion is Amun’s sharing destination. Publication requires a connection,
        your chosen parent section, secret removal, and exact-content review.
        Pi’s gist/Radius sharing is disabled.
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
            <button
              disabled={busy || loginPending}
              onClick={() => {
                setLoginPending(true);
                setLoginStatus("Opening official CLI sign-in…");
                window.postMessage(
                  { kind: "amun-worker-login-command", command: { tool } },
                  "*",
                );
              }}
            >
              Sign in to {tool === "codex" ? "Codex CLI" : "Claude Code CLI"}
            </button>
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
      {loginStatus && <p role="status">{loginStatus}</p>}
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
            "settings",
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
            "export",
            "share",
            "compact",
            "reload",
            "trust",
            "changelog",
            "hotkeys",
            "quit",
          ].map((name) => (
            <option key={name} value={name}>
              /{name}
              {name === "share" ? " — disabled; use Notion" : ""}
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
        ) : result?.kind === "notion-preview" ? (
          <>
            <h4>Review Share to Notion</h4>
            <p>
              Known credentials and detectable secret patterns have been
              removed. Review for confidential information before publishing.
            </p>
            <p>
              {result.omittedItems} internal or non-text items omitted. This is
              the selected session’s current branch.
            </p>
            <h5>{result.title}</h5>
            <textarea
              aria-label="Redacted Notion conversation preview"
              value={result.text}
              readOnly
              rows={12}
            />
            <button disabled>Publish new Notion page</button>
            <p>
              Publishing is blocked until an Amun Notion connection and parent
              section are configured. No content has been uploaded.
            </p>
          </>
        ) : result?.kind === "document" ? (
          <>
            <h4>{result.title}</h4>
            <pre className="native-pi-document">{result.text}</pre>
            <p>
              Page {result.page + 1} of {result.totalPages}
            </p>
            <button
              disabled={busy || result.page === 0}
              onClick={() => run(String(result.page - 1))}
            >
              Previous page
            </button>
            <button
              disabled={busy || result.page + 1 >= result.totalPages}
              onClick={() => run(String(result.page + 1))}
            >
              Next page
            </button>
          </>
        ) : result?.kind === "preferences" ? (
          <fieldset disabled={busy}>
            <legend>Pi session settings</legend>
            <p>
              Changes apply to Amun’s private Pi configuration. Skill resources
              still require explicit loading; this switch does not install them.
            </p>
            {result.fields.map((field) => (
              <label key={field.id}>
                {field.label}
                <select
                  aria-label={field.label}
                  value={field.value}
                  onChange={(event) =>
                    run(
                      JSON.stringify({
                        id: field.id,
                        value: event.target.value,
                      }),
                      "settings",
                    )
                  }
                >
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option === "true"
                        ? "On"
                        : option === "false"
                          ? "Off"
                          : option}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </fieldset>
        ) : result?.kind === "export" ? (
          <>
            <h4>Review {result.format.toUpperCase()} export</h4>
            <p>
              Sessions can contain prompts, file contents and secrets. Review
              this document before saving or sharing it.
            </p>
            <textarea
              aria-label="Export review document"
              readOnly
              value={result.review}
              rows={12}
            />
            <button
              onClick={() => {
                const id = crypto.randomUUID();
                exportPending.current = id;
                setExportStatus("Choose a save location…");
                window.postMessage(
                  {
                    kind: "amun-pi-export-command",
                    command: { id, format: result.format, text: result.text },
                  },
                  "*",
                );
              }}
            >
              Save reviewed export…
            </button>
            <p role="status">{exportStatus}</p>
          </>
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
