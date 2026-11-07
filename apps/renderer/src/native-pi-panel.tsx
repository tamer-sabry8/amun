import { trailingWorkspaceReference } from "../../../packages/contracts/src/workspace-reference.ts";
import { DraftEditor } from "./draft-editor.tsx";
import { pastedImage } from "./pasted-image.ts";
import {
  composerCommand,
  nativeCommandNames,
  piModelShortcut,
} from "./composer-command.ts";
import { HostingForm } from "./hosting-form.tsx";
import { nativePiLoginChoice } from "../../../packages/crew/src/native-pi-login.ts";
import { useEffect, useRef, useState } from "react";
import { nativePiEvent, type NativePiEvent } from "@amun/contracts";
import { bridge } from "./bridge.ts";
function focusReview(heading: HTMLHeadingElement | null) {
  heading?.focus();
}
export function NativePiPanel({
  subscriptionsOnly = false,
  onConnectNotion,
  onBoard,
}: {
  subscriptionsOnly?: boolean;
  onBoard?: (url: string) => void;
  onConnectNotion?: () => void;
}) {
  const [parked, setParked] = useState(false);
  const [open, setOpen] = useState(false),
    [command, setCommand] = useState("session"),
    [argument, setArgument] = useState(""),
    [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NativePiEvent["result"] | null>(null);
  const [loginStatus, setLoginStatus] = useState("");
  const [recoveryUrls, setRecoveryUrls] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const sessionId = result?.kind === "conversation" ? result.sessionId : null;
  const [images, setImages] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const image = sessionId ? images.get(sessionId) : undefined;
  const keepImage = (id: string, data?: string) =>
    setImages((previous) => {
      const next = new Map(previous);
      if (data) next.set(id, data);
      else next.delete(id);
      return next;
    });
  const draft = sessionId ? (drafts.get(sessionId) ?? "") : "";
  function saveDraft(id: string, text: string) {
    setDrafts((previous) => {
      const next = new Map(previous);
      if (text) next.set(id, text);
      else next.delete(id);
      return next;
    });
  }
  const setDraft = (text: string) => {
    if (sessionId) saveDraft(sessionId, text);
  };
  const resources =
    result?.kind === "conversation" ? (result.resources ?? []) : [];
  const slash = composerCommand(draft);
  const shellPrefix = /^(!{1,2})(?![!])([\s\S]*)$/.exec(draft.trim());
  const resourceMatch = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(draft.trim());
  const resource =
    !slash && resourceMatch && resources.includes(resourceMatch[1]!)
      ? resourceMatch[1]
      : undefined;
  const attachmentPicker = useRef<HTMLInputElement>(null);
  const [attachmentError, setAttachmentError] = useState("");
  const extensionPicker = useRef<HTMLInputElement>(null);
  const [extensionAnswer, setExtensionAnswer] = useState("");
  const extensionCommand =
    !slash &&
    resourceMatch &&
    result?.kind === "conversation" &&
    result.extensionCommands?.includes(resourceMatch[1]!)
      ? resourceMatch[1]
      : undefined;
  const draftAction = useRef<HTMLButtonElement>(null);
  const importFile = useRef<HTMLInputElement>(null);
  const [showTools, setShowTools] = useState(false),
    [showSummaries, setShowSummaries] = useState(false);
  const [editingSession, setEditingSession] = useState<string | null>(null);
  const [queueText, renderQueueText] = useState("");
  const queueDraft = useRef({ id: "", text: "" });
  function setQueueText(text: string) {
    queueDraft.current.text = text;
    renderQueueText(text);
  }
  const [queueStatus, setQueueStatus] = useState("");
  const queueSequence = useRef<string | null>(null);
  const [queueWaiting, setQueueWaiting] = useState(false);
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
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (
        event.source !== window ||
        data?.kind !== "amun-folder-result" ||
        !pending.current ||
        data.result?.id !== pending.current ||
        typeof data.result.text !== "string" ||
        data.result.text.length > 65536
      )
        return;
      pending.current = null;
      setBusy(false);
      setResult({ kind: "message", text: data.result.text });
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
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
          if (event.data.result.kind === "turn-queue") {
            const q = event.data.result;
            if (q.sequence !== queueSequence.current) return;
            queueSequence.current = null;
            setQueueWaiting(false);
            setQueueStatus(q.status);
            if (q.accepted) setQueueText(q.recalled ?? "");
            return;
          }
          queueSequence.current = null;
          setQueueWaiting(false);
          if (queueDraft.current.id && queueDraft.current.text) {
            saveDraft(queueDraft.current.id, queueDraft.current.text);
            queueDraft.current = { id: "", text: "" };
            renderQueueText("");
          }
          if (event.data.result.kind === "extension-dialog") {
            setExtensionAnswer(
              event.data.result.method === "editor"
                ? event.data.result.message
                : "",
            );
            setResult(event.data.result);
            return;
          }
          pending.current = null;
          setSending(false);
          setBusy(false);
          if (
            event.data.result.kind === "conversation" &&
            event.data.result.resourceDraft !== undefined
          )
            saveDraft(
              event.data.result.sessionId,
              event.data.result.resourceDraft,
            );
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
    if (selectedCommand === "conversation-send") {
      queueDraft.current.id = sessionId ?? "";
      setQueueStatus("");
      setQueueText("");
    }
    pending.current = id;
    setBusy(true);
    setSending(selectedCommand === "conversation-send");
    if (
      !(selectedCommand === "mcp" && result?.kind === "github-device") &&
      selectedCommand !== "conversation-send" &&
      (selectedCommand !== "settings" || result?.kind !== "preferences")
    )
      setResult(null);
    if (selectedCommand === "mcp" && value === "filesystem") {
      window.postMessage({ kind: "amun-choose-folder", id }, "*");
      return;
    }
    setCopyStatus("");
    copyPending.current = null;
    exportPending.current = null;
    setExportStatus("");
    bridge.send({
      version: 1,
      kind: "native-pi",
      action: "run",
      id,
      command:
        selectedCommand === "extension-list" && value
          ? "extension-remove"
          : selectedCommand,
      argument: value,
    });
  };
  function queue(mode: "steer" | "follow-up" | "recall") {
    if (!sessionId || !pending.current || !sending || queueSequence.current)
      return;
    const sequence = crypto.randomUUID();
    queueSequence.current = sequence;
    setQueueWaiting(true);
    bridge.send({
      version: 1,
      kind: "native-pi",
      action: "queue-input",
      id: pending.current,
      sessionId,
      sequence,
      mode,
      text: mode === "recall" ? "" : queueText,
    });
  }
  function answerDialog(answer: string | boolean | null) {
    if (pending.current && result?.kind === "extension-dialog")
      bridge.send({
        version: 1,
        kind: "native-pi",
        action: "answer-extension",
        id: pending.current,
        dialog: result.dialog,
        answer,
      });
  }
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
      <button
        type="button"
        ref={(el) => {
          if (parked) el?.focus();
        }}
        onClick={() => {
          setParked(false);
          setOpen(true);
        }}
      >
        {parked ? "Resume Pi commands" : "Open Pi commands"}
      </button>
    );
  return (
    <section
      aria-label="Pi commands"
      onKeyDown={(event) => {
        if (
          sending &&
          event.key === "Escape" &&
          !event.nativeEvent.isComposing &&
          pending.current
        ) {
          event.preventDefault();
          bridge.send({
            version: 1,
            kind: "native-pi",
            action: "abort-turn",
            id: pending.current,
          });
          return;
        }
        if (
          result?.kind === "conversation" &&
          !result.calm &&
          !event.nativeEvent.isComposing &&
          event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.repeat
        ) {
          const key = event.key.toLowerCase();
          if (key === "o" || key === "t") {
            event.preventDefault();
            if (key === "o") setShowTools((v) => !v);
            else setShowSummaries((v) => !v);
            return;
          }
        }
        const shortcut = piModelShortcut(event.nativeEvent);
        if (!shortcut) return;
        event.preventDefault();
        if (busy) return;
        if (shortcut === "select") {
          setCommand("model");
          setArgument("");
          run("", "model");
        } else {
          run(shortcut, "cycle-model");
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
      <input
        hidden
        type="file"
        accept=".js,.ts"
        ref={extensionPicker}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file || busy) return;
          try {
            if (file.size > 65536) throw Error();
            const source = new TextDecoder("utf-8", { fatal: true }).decode(
              await file.arrayBuffer(),
            );
            run(
              JSON.stringify({ name: file.name, source }),
              "extension-review",
            );
          } catch {
            setResult({
              kind: "message",
              text: "Choose a UTF-8 JavaScript or TypeScript file of 64 KiB or less.",
            });
          }
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => extensionPicker.current?.click()}
      >
        Review local Pi extension
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setCommand("extension-list");
          run("", "extension-list");
        }}
      >
        Manage trusted extensions
      </button>
      <div data-testid="native-pi-result" aria-live="polite">
        {busy ? "Working…" : null}
        {result?.kind === "publication-receipts" ? (
          <section aria-label="Published conversations">
            <h4>Published conversations</h4>
            {result.unconfirmed.length > 0 && (
              <section aria-label="Unconfirmed publications">
                <h5>Unconfirmed publications</h5>
                <p>
                  Check the destination in Notion before sharing these
                  conversations again. Amun has no confirmed page receipt.
                </p>
                <ul>
                  {result.unconfirmed.map((item) => (
                    <li key={item.id}>
                      {item.title} · {item.delivery ?? "sent-unknown"}
                      {item.delivery !== "not sent" && (
                        <>
                          <label>
                            Notion page URL for {item.title}
                            <input
                              value={recoveryUrls[item.id] ?? ""}
                              onChange={(e) =>
                                setRecoveryUrls({
                                  ...recoveryUrls,
                                  [item.id]: e.target.value,
                                })
                              }
                            />
                          </label>
                          <button
                            disabled={busy}
                            onClick={() =>
                              run(
                                JSON.stringify({
                                  id: item.id,
                                  url: recoveryUrls[item.id] || undefined,
                                }),
                                "notion-reconcile",
                              )
                            }
                          >
                            {recoveryUrls[item.id]
                              ? "Check page URL"
                              : "Retry search"}
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
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
            {!result.calm && (
              <>
                {result.toolOutput && (
                  <>
                    <button
                      aria-expanded={showTools}
                      onClick={() => setShowTools(!showTools)}
                    >
                      Tool output
                    </button>
                    {showTools && (
                      <textarea
                        aria-label="Tool output"
                        value={result.toolOutput}
                        readOnly
                      />
                    )}
                  </>
                )}
                {result.summaries && (
                  <>
                    <button
                      aria-expanded={showSummaries}
                      onClick={() => setShowSummaries(!showSummaries)}
                    >
                      Reasoning summaries
                    </button>
                    {showSummaries && (
                      <textarea
                        aria-label="Reasoning summaries"
                        value={result.summaries}
                        readOnly
                      />
                    )}
                  </>
                )}
              </>
            )}
            <label>
              Message this conversation
              <textarea
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.repeat) return;
                  if (
                    event.ctrlKey &&
                    !event.metaKey &&
                    !event.altKey &&
                    !event.shiftKey &&
                    event.key.toLowerCase() === "z"
                  ) {
                    event.preventDefault();
                    setParked(true);
                    setOpen(false);
                    return;
                  }
                  if (
                    event.shiftKey &&
                    !event.metaKey &&
                    !event.altKey &&
                    !event.ctrlKey &&
                    event.key === "Tab" &&
                    !busy
                  ) {
                    event.preventDefault();
                    run("", "cycle-thinking");
                    return;
                  }
                  if (
                    event.key === "Tab" &&
                    !event.shiftKey &&
                    trailingWorkspaceReference(draft) &&
                    event.currentTarget.selectionEnd === draft.length
                  ) {
                    event.preventDefault();
                    run(
                      JSON.stringify({ sessionId: result.sessionId, draft }),
                      "file-complete",
                    );
                    return;
                  }
                  if (event.ctrlKey && event.key.toLowerCase() === "g") {
                    event.preventDefault();
                    setEditingSession(result.sessionId);
                    return;
                  }
                  const el = event.currentTarget;
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.altKey &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !shellPrefix
                  ) {
                    event.preventDefault();
                    draftAction.current?.click();
                  } else if (event.ctrlKey && event.key.toLowerCase() === "j") {
                    event.preventDefault();
                    el.setRangeText(
                      "\n",
                      el.selectionStart,
                      el.selectionEnd,
                      "end",
                    );
                    setDraft(el.value);
                  } else if (
                    event.ctrlKey &&
                    event.key.toLowerCase() === "c" &&
                    el.selectionStart === el.selectionEnd &&
                    draft
                  ) {
                    event.preventDefault();
                    setDraft("");
                  } else if (
                    event.ctrlKey &&
                    event.key.toLowerCase() === "d" &&
                    !draft
                  ) {
                    event.preventDefault();
                    run("", "quit");
                  }
                }}
                onPaste={async (event) => {
                  const file = Array.from(event.clipboardData.files).find((f) =>
                    f.type.startsWith("image/"),
                  );
                  if (!file || busy) return;
                  event.preventDefault();
                  const id = result.sessionId;
                  setBusy(true);
                  try {
                    keepImage(id, await pastedImage(file));
                    setAttachmentError("");
                  } catch {
                    setAttachmentError(
                      "Choose a smaller PNG, JPEG or WebP image.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
                aria-label="Conversation message"
                value={draft}
                maxLength={12000}
                disabled={busy}
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setAttachmentError("");
                attachmentPicker.current?.click();
              }}
            >
              Attach text file
            </button>
            <input
              type="file"
              hidden
              ref={attachmentPicker}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file || busy) return;
                setBusy(true);
                try {
                  if (file.size > 12000 || !file.size) throw Error();
                  const content = new TextDecoder("utf-8", {
                    fatal: true,
                  }).decode(await file.arrayBuffer());
                  const payload = JSON.stringify({
                    sessionId: result.sessionId,
                    draft,
                    name: file.name,
                    content,
                  });
                  if (
                    payload.length > 16384 ||
                    draft.length + file.name.length + content.length + 18 >
                      12000
                  )
                    throw Error();
                  run(payload, "attach-text");
                } catch {
                  setBusy(false);
                  setAttachmentError(
                    "Choose a UTF-8 text file that fits in the 12,000-character conversation draft.",
                  );
                }
              }}
            />
            <button
              disabled={busy}
              onClick={() => setEditingSession(result.sessionId)}
            >
              Edit draft…
            </button>
            {editingSession === result.sessionId && (
              <DraftEditor
                key={result.sessionId}
                initial={draft}
                apply={(value) => saveDraft(result.sessionId, value)}
                close={() => setEditingSession(null)}
              />
            )}
            {result.fileOptions && (
              <div aria-label="Workspace files">
                {result.fileOptions.length ? (
                  result.fileOptions.map((p) => (
                    <button
                      key={p}
                      disabled={busy}
                      onClick={() =>
                        run(
                          JSON.stringify({
                            sessionId: result.sessionId,
                            draft,
                            pick: p,
                          }),
                          "file-attach",
                        )
                      }
                    >
                      {(p.endsWith("/") ? "Complete " : "Attach ") + p}
                    </button>
                  ))
                ) : (
                  <p>No matching workspace files.</p>
                )}
              </div>
            )}
            {image && (
              <div>
                <img
                  width="96"
                  alt="Image attached to this conversation"
                  src={"data:image/png;base64," + image}
                />
                {!result.acceptsImage && (
                  <p role="status">
                    Choose a model that accepts images and enable images in Pi
                    settings to send this attachment.
                  </p>
                )}
                <button
                  disabled={busy}
                  onClick={() => keepImage(result.sessionId)}
                >
                  Remove image
                </button>
              </div>
            )}
            {attachmentError && <p role="status">{attachmentError}</p>}
            {draft.trim() === "/" && (
              <label>
                Choose a slash command
                <select
                  value=""
                  onChange={(e) => setDraft("/" + e.target.value)}
                >
                  <option value="">Choose a command</option>
                  {[
                    ...new Set([
                      ...nativeCommandNames,
                      ...resources,
                      ...(result.extensionCommands ?? []),
                    ]),
                  ].map((name) => (
                    <option key={name} value={name}>
                      /{name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {draft.trim().startsWith("/") &&
              !slash &&
              !extensionCommand &&
              !resource &&
              draft.trim() !== "/" && (
                <p role="status">
                  This command is unavailable in the active conversation.
                </p>
              )}
            <button
              type="button"
              ref={draftAction}
              disabled={
                busy ||
                (shellPrefix
                  ? !shellPrefix[2]!.trim() || shellPrefix[2]!.length > 8192
                  : !slash &&
                    !extensionCommand &&
                    !resource &&
                    (!result.model ||
                      !draft.trim() ||
                      (!!image && !result.acceptsImage) ||
                      /^[!/]/.test(draft.trimStart()) ||
                      JSON.stringify({
                        sessionId: result.sessionId,
                        model: result.model,
                        text: draft,
                      }).length > 16384))
              }
              onClick={() => {
                if (shellPrefix) {
                  run(
                    JSON.stringify({
                      sessionId: result.sessionId,
                      command: shellPrefix[2]!.trim(),
                      excludeFromContext: shellPrefix[1] === "!!",
                    }),
                    "captain-shell",
                  );
                  setDraft("");
                  return;
                }
                if (extensionCommand) {
                  run(
                    JSON.stringify({
                      sessionId: result.sessionId,
                      name: extensionCommand,
                      argument: resourceMatch?.[2] ?? "",
                    }),
                    "extension-command",
                  );
                  return;
                }
                if (resource) {
                  run(
                    JSON.stringify({
                      sessionId: result.sessionId,
                      name: resource,
                      argument: resourceMatch?.[2] ?? "",
                    }),
                    "resource-draft",
                  );
                  return;
                }
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
                    ...(image ? { image } : {}),
                  }),
                  "conversation-send",
                );
                keepImage(result.sessionId);
                setDraft("");
              }}
            >
              {shellPrefix
                ? shellPrefix[1] === "!!"
                  ? "Run shell without model context"
                  : "Run shell with model context"
                : extensionCommand
                  ? "Run /" + extensionCommand
                  : resource
                    ? "Apply /" + resource
                    : slash
                      ? "Run /" + slash.name
                      : "Send message"}
            </button>
            {sending && (
              <fieldset disabled={queueWaiting}>
                <label>
                  Message during response
                  <textarea
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing || event.repeat) return;
                      if (
                        event.altKey &&
                        event.key === "ArrowUp" &&
                        !queueText
                      ) {
                        event.preventDefault();
                        queue("recall");
                      } else if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        queueText.trim()
                      ) {
                        event.preventDefault();
                        queue(event.altKey ? "follow-up" : "steer");
                      }
                    }}
                    value={queueText}
                    maxLength={12000}
                    onChange={(e) => setQueueText(e.target.value)}
                  />
                </label>
                <button
                  disabled={!queueText.trim()}
                  onClick={() => queue("steer")}
                >
                  Steer response
                </button>
                <button
                  disabled={!queueText.trim()}
                  onClick={() => queue("follow-up")}
                >
                  Queue follow-up
                </button>
                <button disabled={!!queueText} onClick={() => queue("recall")}>
                  Recall queued messages
                </button>
                {queueStatus && <p role="status">{queueStatus}</p>}
              </fieldset>
            )}
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
              commands. Shell commands run with your Mac account permissions.
            </p>
            {!result.calm && (
              <p>
                Text view only. {result.omittedItems} non-text or internal
                entries omitted. Secrets are redacted.
              </p>
            )}
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
        ) : result?.kind === "extension-review" ? (
          <section>
            <h4>Review {result.name}</h4>
            <p>
              Trust lets this code execute as your Mac account when Pi loads it.
              Amun installs the displayed copy.
            </p>
            <p>SHA-256 {result.digest}</p>
            <textarea
              aria-label="Extension source to trust"
              value={result.source}
              readOnly
            />
            <button
              disabled={busy}
              onClick={() => run(result.id, "extension-install")}
            >
              Trust this exact extension
            </button>
            <button onClick={() => setResult(null)}>Cancel review</button>
          </section>
        ) : result?.kind === "extension-dialog" ? (
          <section>
            <h4>{result.title}</h4>
            <p>{result.message}</p>
            {result.method === "select" ? (
              result.options.map((option) => (
                <button key={option} onClick={() => answerDialog(option)}>
                  {option}
                </button>
              ))
            ) : result.method === "confirm" ? (
              <button onClick={() => answerDialog(true)}>
                Confirm extension request
              </button>
            ) : (
              <>
                <textarea
                  aria-label="Extension answer"
                  value={extensionAnswer}
                  onChange={(e) => setExtensionAnswer(e.target.value)}
                />
                <button onClick={() => answerDialog(extensionAnswer)}>
                  Submit extension answer
                </button>
              </>
            )}
            <button onClick={() => answerDialog(null)}>
              Cancel extension request
            </button>
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
            <h4 key="Review Share to Notion" ref={focusReview} tabIndex={-1}>
              Review Share to Notion
            </h4>
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
            <h4 key="Approve Share to Notion" ref={focusReview} tabIndex={-1}>
              Approve Share to Notion
            </h4>
            {result.markerPropertyId && (
              <p>Amun publication ID: {result.markerPropertyId}</p>
            )}
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
        ) : result?.kind === "bearings-board" ? (
          <>
            <p>{result.text}</p>
            <button type="button" onClick={() => onBoard?.(result.url)}>
              Open local Bearings board
            </button>
          </>
        ) : result?.kind === "message" || result?.kind === "copy" ? (
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
