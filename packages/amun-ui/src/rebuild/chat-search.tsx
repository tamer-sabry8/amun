// Search chats (owner's chat handoff, approved 20 November 2026): words in
// every chat, Recent, Folders and General alike, grouped by chat and labelled
// with the folder or General. Choosing a passage opens the chat at it; "Back
// to results" brings back the same words, matches and scroll position.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { contentSearchResult } from "../../../../packages/contracts/src/work.ts";
import {
  chatKey,
  chatLists,
  type ChatEntry,
} from "../../../../packages/domain/src/work/chat-lists.ts";
import { generalConversationName } from "../../../../packages/domain/src/work/model.ts";
import { bridge } from "../bridge.ts";
import { Icon } from "../icons.tsx";
import type { ContentHit } from "./chrome.tsx";
import type { Snapshot } from "./view-model.ts";

/** Kept across opening a result and coming back. */
const kept = { query: "", scroll: 0, hits: [] as ContentHit[], q: "" };

export interface ChatGroup {
  entry: ChatEntry;
  hits: ContentHit[];
}
/** Message hits grouped by the chat they are in, best match first. */
export function groupByChat(
  hits: readonly ContentHit[],
  snapshot: Pick<Snapshot, "areas" | "chats" | "messages" | "setup">,
): ChatGroup[] {
  const lists = chatLists(
    snapshot.areas,
    snapshot.chats,
    snapshot.messages,
    null,
    generalConversationName,
  );
  const where = new Map<string, string>();
  for (const message of snapshot.messages)
    where.set(message.id, chatKey(message.workAreaId, null));
  for (const chat of snapshot.chats)
    for (const message of chat.messages)
      where.set(message.id, chatKey(chat.workAreaId, chat.id));
  const groups = new Map<string, ChatGroup>();
  for (const hit of hits) {
    if (hit.kind !== "message") continue;
    const key = where.get(hit.id);
    const entry = key ? lists.byKey.get(key) : undefined;
    if (!entry) continue;
    const group = groups.get(entry.key) ?? { entry, hits: [] };
    group.hits.push(hit);
    groups.set(entry.key, group);
  }
  return [...groups.values()];
}

export function ChatSearch({
  open,
  restoring,
  snapshot,
  onClose,
  onOpen,
}: {
  open: boolean;
  /** Reopened by "Back to results": keep the words and the place. */
  restoring: boolean;
  snapshot: Snapshot;
  onClose(): void;
  onOpen(entry: ChatEntry, messageId: string): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(kept.query);
  const [found, setFound] = useState({ q: kept.q, hits: kept.hits });
  useEffect(() => {
    if (open && !dialog.current?.open) {
      if (!restoring) {
        setQuery("");
        setFound({ q: "", hits: [] });
        kept.scroll = 0;
      }
      dialog.current?.showModal();
    } else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  useLayoutEffect(() => {
    if (open && restoring && results.current)
      results.current.scrollTop = kept.scroll;
  }, [open, restoring, found.hits.length]);
  const q = query.trim();
  useEffect(() => {
    if (!open || q.length < 2 || found.q === q) return;
    const requestId = crypto.randomUUID();
    const stop = bridge.onEvent((raw) => {
      const event = contentSearchResult.safeParse(raw);
      if (event.success && event.data.requestId === requestId)
        setFound({ q, hits: event.data.hits });
    });
    const timer = setTimeout(
      () =>
        bridge.send({
          version: 1,
          kind: "content-search",
          requestId,
          query: q,
        }),
      150,
    );
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [open, q]);
  kept.query = query;
  kept.q = found.q;
  kept.hits = found.hits;
  const groups =
    found.q === q && q.length >= 2 ? groupByChat(found.hits, snapshot) : [];
  const count = groups.length;
  return (
    <dialog
      className="rb-palette rb-chat-search"
      ref={dialog}
      aria-label="Search chats"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <div className="field">
        <Icon name="search" width={16} height={16} />
        <input
          autoFocus
          aria-label="Search chats"
          placeholder="Search chats…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {count > 0 && (
          <span className="muted small" aria-live="polite">
            {count} {count === 1 ? "chat" : "chats"}
          </span>
        )}
      </div>
      <div
        className="results"
        ref={results}
        onScroll={(event) => (kept.scroll = event.currentTarget.scrollTop)}
      >
        {groups.map((group) => (
          <section key={group.entry.key} className="group">
            <h3>
              <span className="name">{group.entry.title}</span>
              <span className="muted">
                {" "}
                · {group.entry.folder ?? "General"}
              </span>
              {group.entry.archived && (
                <span className="muted"> · Archived</span>
              )}
            </h3>
            {group.hits.map((hit) => (
              <button
                key={hit.id}
                className="passage"
                onClick={() => onOpen(group.entry, hit.id)}
              >
                <span className="who">
                  {hit.role === "you" ? "You" : "Firstmate"}
                </span>
                <span className="text">
                  {hit.snippet.map((part, index) =>
                    part.match ? (
                      <mark key={index}>{part.text}</mark>
                    ) : (
                      part.text
                    ),
                  )}
                </span>
              </button>
            ))}
          </section>
        ))}
        {q.length >= 2 && found.q === q && !groups.length && (
          <p className="muted" style={{ padding: "10px 12px" }}>
            No chat mentions “{q}”.
          </p>
        )}
        {q.length < 2 && (
          <p className="muted" style={{ padding: "10px 12px" }}>
            Type at least two letters to search every chat.
          </p>
        )}
      </div>
    </dialog>
  );
}
