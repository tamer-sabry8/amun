import { useEffect, useRef, useState } from "react";
import {
  workspaceEvent,
  chatResult,
  type WorkspaceSnapshot,
} from "@amun/contracts";
import { bridge } from "./bridge.ts";
import { Icon } from "./icons.tsx";
type Context = WorkspaceSnapshot["productContext"];
export function FirstmateComposer({
  context,
  request,
}: {
  context: Context;
  request: { id: string; ask: string } | null;
}) {
  const [draft, setDraft] = useState(""),
    [model, setModel] = useState(context?.allowedModels[0] ?? ""),
    [difficulty, level] = useState("standard"),
    [story, setStory] = useState(""),
    [preview, show] = useState(""),
    [status, notify] = useState(""),
    [history, refresh] = useState<
      NonNullable<ReturnType<typeof chatResult.parse>["history"]>
    >([]),
    [working, busy] = useState(false);
  const requests = useRef(new Set<string>());
  const productId = context?.productId;
  useEffect(() => {
    if (!productId) return;
    const stop = bridge.onEvent((raw) => {
      if (
        raw &&
        typeof raw === "object" &&
        "kind" in raw &&
        raw.kind === "service-lost"
      ) {
        requests.current.clear();
        busy(false);
        notify("Connection interrupted.");
        return;
      }
      const skill = workspaceEvent.safeParse(raw);
      if (
        skill.success &&
        skill.data.kind === "workspace-skill-draft" &&
        skill.data.productId === productId
      ) {
        setDraft(skill.data.text);
        return;
      }
      const parsed = chatResult.safeParse(raw);
      if (!parsed.success || parsed.data.productId !== productId) return;
      const e = parsed.data;
      if (e.history) refresh(e.history);
      if (!requests.current.has(e.id)) return;
      if (e.phase === "stream") {
        show(e.text);
        return;
      }
      if (e.phase === "queued") {
        notify(e.text);
        return;
      }
      if (e.phase === "done" || e.phase === "error") {
        requests.current.delete(e.id);
        busy(requests.current.size > 0);
        show("");
        notify(e.phase === "error" ? e.text : "Reply received.");
      }
    });
    bridge.send({
      version: 1,
      kind: "firstmate-chat",
      action: "history",
      id: crypto.randomUUID(),
      productId,
    });
    return stop;
  }, [productId]);
  const routed = context?.routes.find(
    (r) => r.task === "conversation" && r.difficulty === difficulty,
  )?.model;
  const selectedModel =
    routed ??
    (context?.allowedModels.includes(model)
      ? model
      : (context?.allowedModels[0] ?? ""));
  const send = (action: "send" | "steer" | "follow-up") => {
    if (!productId || !draft.trim() || !selectedModel) return;
    const id = crypto.randomUUID();
    requests.current.add(id);
    busy(true);
    notify("Waiting for Firstmate…");
    bridge.send({
      version: 1,
      kind: "firstmate-chat",
      action,
      turn: {
        id,
        productId,
        model: selectedModel,
        difficulty,
        selection: story || request?.id || null,
        text: draft,
      },
    });
    setDraft("");
  };
  return (
    <section aria-label="Firstmate conversation">
      {context && (
        <details>
          <summary>Conversation history ({history.length})</summary>
          {history.map((t) => (
            <article key={t.id}>
              <p>{t.text}</p>
              <p>
                {t.reply ?? t.state} · {t.model}
              </p>
            </article>
          ))}
        </details>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(working ? "steer" : "send");
        }}
      >
        <label className="sr-only" htmlFor="composer-input">
          Ask Firstmate
        </label>
        <input
          id="composer-input"
          maxLength={12000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!context}
          placeholder={
            request ? "Ask Firstmate about this request…" : "Ask Firstmate…"
          }
        />
        {context && (
          <>
            <label>
              Conversation difficulty
              <select
                value={difficulty}
                onChange={(e) => level(e.target.value)}
              >
                <option>standard</option>
                <option>complex</option>
              </select>
            </label>
            <label>
              Conversation model
              <select
                disabled={!!routed}
                value={selectedModel}
                onChange={(e) => setModel(e.target.value)}
              >
                {context.allowedModels.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label>
              Conversation context
              <select value={story} onChange={(e) => setStory(e.target.value)}>
                <option value="">
                  {request ? request.ask : "Product conversation"}
                </option>
                {context.storyDrafts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <button
          className="primary icon-button"
          aria-label={working ? "Steer Firstmate" : "Send to Firstmate"}
          disabled={!draft.trim() || !selectedModel}
        >
          <Icon name="send" />
        </button>
        {working && (
          <button
            type="button"
            disabled={!draft.trim()}
            onClick={() => send("follow-up")}
          >
            Queue follow-up
          </button>
        )}
      </form>
      {preview && <p aria-label="Streaming Firstmate reply">{preview}</p>}
      {status && <p role="status">{status}</p>}
      {history.at(-1)?.reply && (
        <p aria-label="Latest Firstmate reply">{history.at(-1)?.reply}</p>
      )}
    </section>
  );
}
