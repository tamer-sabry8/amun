import { composerCommand, nativeCommandNames } from "./composer-command.ts";
import { HostingForm } from "./hosting-form.tsx";
import { nativePiLoginChoice } from "../../../packages/crew/src/native-pi-login.ts";
import { useEffect, useRef, useState } from "react";
import { nativePiEvent, type NativePiEvent } from "@amun/contracts";
import { bridge } from "./bridge.ts";
export function NativePiPanel({
  subscriptionsOnly = false,
  onConnectNotion,
}: {
  subscriptionsOnly?: boolean;
  onConnectNotion?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [command, setCommand] = useState("session"),
    [argument, setArgument] = useState(""),
    [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NativePiEvent["result"] | null>(null);
  const [loginStatus, setLoginStatus] = useState("");
  const [draft, setDraft] = useState("");
  const slash = composerCommand(draft);
  const importFile = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
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
          setSending(false);
          setBusy(false);
          setResult(event.data.result);
        } else if (
          value &&
          typeof value === "object" &&
          "kind" in value &&
          value.kind === "service-lost"
        ) {
          pending.current = null;
          setSending(false);
          setBusy(false);
          setResult({
            kind: "message",
            text: "Session connection lost. Reopen the view to reconnect.",
          });
        }
      }),
    [],
  );
  // Navigation does not own the service session. Explicit /quit or service shutdown closes it.
  const copyText = (text: string) => {
    const id = crypto.randomUUID();
    copyPending.current = id;
    setCopyStatus("Copying…");
    window.postMessage(
      {
        kind: "amun-pi-clipboard-command",
        command: { action: "copy", id, text },
      },
      "*",
    );
  };
  const run = (value = argument, selectedCommand = command) => {
    if (selectedCommand === "login") {
      try {
        const choice = nativePiLoginChoice(value);
        if (choice.kind === "choices") setResult(choice);
        else {
          bridge.send(choice);
          setResult({
            kind: "message",
            text: "Complete the provider sign-in prompt. Opening sign-in does not prove model access.",
          });
        }
      } catch {
        setResult({
          kind: "message",
          text: "Choose a supported Pi provider from the sign-in list.",
        });
      }
      return;
    }
    if (selectedCommand === "quit") {
      bridge.send({ version: 1, kind: "native-pi", action: "close" });
      setOpen(false);
      setResult(null);
      return;
    }
    const id = crypto.randomUUID();
    pending.current = id;
    setBusy(true);
    setSending(selectedCommand === "conversation-send");
    if (
      !(selectedCommand === "mcp" && result?.kind === "github-device") &&
      selectedCommand !== "conversation-send" &&
      (selectedCommand !== "settings" || result?.kind !== "preferences")
    )
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
  const subscriptions = (
    <>
      <h4>CLI subscriptions</h4>
      <p className="muted">
        These checks use your separate Amun CLI profiles. Pi model-provider
        authorization is managed in Models. Inference checks send a small test
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
            <button
              type="button"
              disabled={busy}
              onClick={() => run(tool, "worker-status")}
            >
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
      <div data-testid="native-pi-result" aria-live="polite">
        {result?.kind === "message" ? result.text : null}
      </div>
    </>
  );
  if (subscriptionsOnly) return <section>{subscriptions}</section>;
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Open Pi commands
      </button>
    );
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
      {onConnectNotion && (
        <button type="button" disabled={busy} onClick={onConnectNotion}>
          Set up Notion sharing
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => run("", "notion-receipts")}
      >
        Published conversations
      </button>
      <p className="muted">
        This session belongs to Amun. Personal Pi sessions are separate. Empty
        sessions are saved after their first message.
      </p>
      <div className="button-row">
        <button
          type="button"
          disabled={busy}
          onClick={() => run("", "conversation")}
        >
          Read active conversation
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run("", "share-notion")}
        >
          Share to Notion
        </button>
      </div>
      <p className="muted">
        Notion is Amun’s sharing destination. Publication requires a connection,
        your chosen parent section, secret removal, and exact-content review.
        Pi’s gist/Radius sharing is disabled.
      </p>
      <label>
        Import Pi session JSONL (maximum 512 KiB)
        <input
          ref={importFile}
          type="file"
          accept=".jsonl,application/jsonl"
          disabled={busy}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            if (file.size > 524288) {
              setResult({
                kind: "message",
                text: "Import exceeds the 512 KiB review limit.",
              });
              return;
            }
            try {
              run(await file.text(), "import-preview");
            } catch {
              setResult({
                kind: "message",
                text: "Could not read this session file.",
              });
            }
          }}
        />
      </label>
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
          {nativeCommandNames.map((name) => (
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
        <button
          type="button"
          disabled={busy}
          onClick={() => run("backward", "cycle-model")}
        >
          Previous model
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run("forward", "cycle-model")}
        >
          Next model
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run("", "cycle-thinking")}
        >
          Cycle thinking level
        </button>
        <button type="button" disabled={busy} onClick={() => run()}>
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
        {result?.kind === "publication-receipts" ? (
          <section aria-label="Published conversations">
            <h4>Published conversations</h4>
            <p>
              Latest 50 verified receipts from this workspace. Reading receipts
              does not publish again.
            </p>
            {result.pages.length === 0 ? (
              <p>No verified publication receipts yet.</p>
            ) : (
              result.pages.map((page) => (
                <article key={page.id}>
                  <h5>{page.title}</h5>
                  <label>
                    Notion page URL
                    <input
                      aria-label={"Notion page URL for " + page.title}
                      value={page.url}
                      readOnly
                    />
                  </label>
                </article>
              ))
            )}
          </section>
        ) : result?.kind === "conversation" ? (
          <section aria-label="Active conversation">
            <h4>{result.title}</h4>
            <p>Session: {result.sessionId}</p>
            <p>Model: {result.model ?? "Select a model before sending"}</p>
            {result.text ? (
              <textarea
                className="native-pi-review-content"
                aria-label="Active conversation text"
                value={result.text}
                readOnly
              />
            ) : (
              <p>No conversation messages yet.</p>
            )}
            <label>
              Message this conversation
              <textarea
                aria-label="Conversation message"
                value={draft}
                maxLength={12000}
                disabled={sending}
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            {draft.trim() === "/" && (
              <label>
                Choose a slash command
                <select
                  value=""
                  onChange={(e) => setDraft("/" + e.target.value)}
                >
                  <option value="">Choose a command</option>
                  {nativeCommandNames.map((name) => (
                    <option key={name} value={name}>
                      /{name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {draft.trim().startsWith("/") && !slash && draft.trim() !== "/" && (
              <p role="status">
                This command is unavailable in the active conversation.
              </p>
            )}
            <button
              type="button"
              disabled={
                busy ||
                (!slash &&
                  (!result.model ||
                    !draft.trim() ||
                    /^[!/]/.test(draft.trimStart()) ||
                    JSON.stringify({
                      sessionId: result.sessionId,
                      model: result.model,
                      text: draft,
                    }).length > 16384))
              }
              onClick={() => {
                if (slash) {
                  if (slash.name === "import") {
                    importFile.current?.click();
                    return;
                  }
                  setCommand(slash.name);
                  setArgument(slash.argument);
                  setDraft("");
                  run(slash.argument, slash.name);
                  return;
                }
                run(
                  JSON.stringify({
                    sessionId: result.sessionId,
                    model: result.model,
                    text: draft,
                  }),
                  "conversation-send",
                );
                setDraft("");
              }}
            >
              {slash ? "Run /" + slash.name : "Send message"}
            </button>
            {sending && (
              <button
                type="button"
                onClick={() => {
                  if (pending.current)
                    bridge.send({
                      version: 1,
                      kind: "native-pi",
                      action: "abort-turn",
                      id: pending.current,
                    });
                }}
              >
                Stop response
              </button>
            )}
            <p>
              Send uses the displayed model. Use the command selector for slash
              commands. No shell or external tools run here.
            </p>
            <p>
              Text view only. {result.omittedItems} non-text or internal entries
              omitted. Secrets are redacted.
            </p>
          </section>
        ) : result?.kind === "hosting-setup" ? (
          <HostingForm
            saved={result.destination}
            save={(v) => run(JSON.stringify(v), "hosting-save")}
            inspect={() => run("cloudflare-hosting-check", "mcp")}
          />
        ) : result?.kind === "github-issue-review" ? (
          <section>
            <h3>Review GitHub issue</h3>
            <p>
              Repository: {result.owner}/{result.repo}
            </p>
            <h4>{result.title}</h4>
            <p>{result.body}</p>
            <button
              disabled={busy}
              onClick={() =>
                run(
                  JSON.stringify({
                    reviewId: result.id,
                    binding: result.binding,
                  }),
                  "github-issue-publish",
                )
              }
            >
              Approve and create this issue
            </button>
            <button onClick={() => setResult(null)}>Close review</button>
          </section>
        ) : result?.kind === "github-device" ? (
          <section aria-label="GitHub device sign-in">
            <h3>GitHub device code</h3>
            <label>
              Code to enter in Edge
              <input
                autoFocus
                aria-label="GitHub device code"
                value={result.code}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
              />
            </label>
            <p>
              Copy this code, then open Microsoft Edge and paste it on GitHub’s
              device verification page.
            </p>
            <button onClick={() => copyText(result.code)}>
              Copy device code
            </button>
            <span role="status">{copyStatus}</span>
            <button disabled={busy} onClick={() => run("github-open", "mcp")}>
              Open Microsoft Edge
            </button>
            <button disabled={busy} onClick={() => run("github-finish", "mcp")}>
              Check GitHub authorization
            </button>
            <button disabled={busy} onClick={() => run("github-cancel", "mcp")}>
              Cancel GitHub sign-in
            </button>
          </section>
        ) : result?.kind === "session-tree" ? (
          <section>
            <h4>Session tree</h4>
            {!result.rows.length && <p>This session has no entries.</p>}
            <ol aria-label="Session tree entries">
              {result.rows.map((row) => (
                <li
                  key={row.id}
                  style={{ marginInlineStart: Math.min(row.depth, 8) + "em" }}
                >
                  <button
                    type="button"
                    aria-current={row.current ? "step" : undefined}
                    onClick={() => run(row.id, "tree")}
                  >
                    {row.type} · {row.id} · Level {row.depth + 1}
                    {row.current ? " · Current" : ""}
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ) : result?.kind === "choices" ? (
          <>
            <h4>{result.title}</h4>
            <ul className="plain-list">
              {result.choices.map((choice) => (
                <li key={choice.id}>
                  <button type="button" onClick={() => run(choice.id)}>
                    {choice.label}
                  </button>
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
              className="native-pi-review-content"
              aria-label="Redacted Notion conversation preview"
              value={result.text}
              readOnly
              rows={12}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => run("", "notion-review")}
            >
              Review destination and exact publication
            </button>
            <p>
              Publishing remains blocked until the destination is verified and
              you approve the final review. No content has been uploaded.
            </p>
          </>
        ) : result?.kind === "import-review" ? (
          <>
            <h4>Review session import</h4>
            <p>
              Retain session ID: <code>{result.sessionId}</code> ·{" "}
              {result.entries} entries
            </p>
            <p>
              Original working directory: <code>{result.originalCwd}</code>
            </p>
            <p>
              Use Amun’s isolated directory instead:{" "}
              <code>{result.targetCwd}</code>
            </p>
            <p>
              The original file is unchanged. Imported context can contain
              sensitive content. No model request or tool execution occurs
              during import.
            </p>
            {result.removedParent && (
              <p>
                The external parent-session link will be removed from the
                imported copy.
              </p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => run(result.token, "import")}
            >
              Confirm import into Amun
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setResult(null)}
            >
              Cancel import
            </button>
          </>
        ) : result?.kind === "notion-review" ? (
          <>
            <h4>Approve Share to Notion</h4>
            <p>New page in {result.destination}</p>
            <p>
              Destination ID: <code>{result.destinationId}</code>
            </p>
            <h5>{result.title}</h5>
            <textarea
              className="native-pi-review-content"
              aria-label="Exact Notion publication content"
              readOnly
              value={result.text}
              rows={14}
            />
            <p>
              Review this exact content and destination. It inherits the
              destination’s Notion permissions. Publishing creates one new page.
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(
                  JSON.stringify({
                    reviewId: result.reviewId,
                    binding: result.binding,
                  }),
                  "notion-publish",
                )
              }
            >
              Approve and publish this content
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setResult(null)}
            >
              Cancel review
            </button>
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
              <button onClick={() => copyText(result.text)}>
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
