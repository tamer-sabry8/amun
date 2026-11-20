// What Amun remembers about the owner's chats on this Mac, across screens and
// restarts (owner's chat handoff, 20 November 2026): unsent drafts, which
// sidebar view is chosen, the last chat opened and where the owner stopped
// reading in each chat. None of it is sent anywhere. Storage is best effort:
// if it is unavailable, everything still works for the current run.
import { useSyncExternalStore } from "react";

export type SidebarView = "recent" | "folders" | "general";
export const sidebarViews: readonly SidebarView[] = [
  "recent",
  "folders",
  "general",
];
export const sidebarViewName: Record<SidebarView, string> = {
  recent: "Recent",
  folders: "Folders",
  general: "General",
};

/** Where reading stopped: the message at the top of the view. */
export interface ReadingSpot {
  messageId: string;
  /** Pixels from the top of that message to the top of the view. */
  offset: number;
}
export interface AskCard {
  /** Plain label, e.g. "Gitex · Project". */
  label: string;
  /** The record's fields as shown and sent, in order. */
  fields: [string, string][];
  /** The record itself, sent with the first message. */
  record: unknown;
}
interface Memory {
  view: SidebarView;
  drafts: Record<string, string>;
  /** The chat key opened last, even if only read. */
  last: string | null;
  spots: Record<string, ReadingSpot>;
  /** A chat started from a card, with what it carries, until first send. */
  asks: Record<string, AskCard>;
}
const storageKey = "amun.chat-memory";
const empty = (): Memory => ({
  view: "folders",
  drafts: {},
  last: null,
  spots: {},
  asks: {},
});
function load(): Memory {
  try {
    const raw = JSON.parse(
      localStorage.getItem(storageKey) ?? "null",
    ) as Partial<Memory> | null;
    if (!raw || typeof raw !== "object") return empty();
    return {
      view: sidebarViews.includes(raw.view as SidebarView)
        ? (raw.view as SidebarView)
        : "folders",
      drafts: typeof raw.drafts === "object" && raw.drafts ? raw.drafts : {},
      last: typeof raw.last === "string" ? raw.last : null,
      spots: typeof raw.spots === "object" && raw.spots ? raw.spots : {},
      asks: typeof raw.asks === "object" && raw.asks ? raw.asks : {},
    };
  } catch {
    return empty();
  }
}
let memory = load();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function change(next: Memory) {
  memory = next;
  for (const listener of listeners) listener();
  // Typing changes a draft on every key; writing is batched.
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}
function flush() {
  saveTimer = null;
  try {
    localStorage.setItem(storageKey, JSON.stringify(memory));
  } catch {
    // Kept in memory for this run.
  }
}
if (typeof window !== "undefined")
  window.addEventListener("beforeunload", () => {
    if (saveTimer) flush();
  });
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export function useChatMemory(): Memory {
  return useSyncExternalStore(
    subscribe,
    () => memory,
    () => memory,
  );
}
export const chatMemory = () => memory;

/** The draft shared by Home and the global New chat. */
export const homeDraftKey = "home";
export const folderDraftKey = (areaId: string) => `folder:${areaId}`;
export const chatDraftKey = (key: string) => `chat:${key}`;
export const askDraftKey = (key: string) => `ask:${key}`;

export function setDraft(key: string, text: string) {
  if ((memory.drafts[key] ?? "") === text) return;
  const drafts = { ...memory.drafts };
  if (text.trim()) drafts[key] = text;
  else delete drafts[key];
  change({ ...memory, drafts });
}
export const draftOf = (key: string) => memory.drafts[key] ?? "";
export function setView(view: SidebarView) {
  if (memory.view !== view) change({ ...memory, view });
}
export function setLast(key: string) {
  if (memory.last !== key) change({ ...memory, last: key });
}
export function setSpot(key: string, spot: ReadingSpot | null) {
  const spots = { ...memory.spots };
  if (spot) spots[key] = spot;
  else delete spots[key];
  change({ ...memory, spots });
}
export function setAsk(key: string, card: AskCard | null) {
  const asks = { ...memory.asks };
  if (card) asks[key] = card;
  else delete asks[key];
  change({ ...memory, asks });
}
/** A chat that moved keeps what was remembered about it. */
export function renameKey(from: string, to: string) {
  if (from === to) return;
  const move = <T>(record: Record<string, T>, a: string, b: string) => {
    if (!(a in record)) return record;
    const next = { ...record, [b]: record[a]! };
    delete next[a];
    return next;
  };
  change({
    ...memory,
    drafts: move(memory.drafts, chatDraftKey(from), chatDraftKey(to)),
    spots: move(memory.spots, from, to),
    last: memory.last === from ? to : memory.last,
  });
}

// ── Firstmate writing in a chat, for the small indicator on its row ──
const writing = new Set<string>();
const writingListeners = new Set<() => void>();
let writingVersion = 0;
export function setWriting(key: string, on: boolean) {
  if (on === writing.has(key)) return;
  if (on) writing.add(key);
  else writing.delete(key);
  writingVersion += 1;
  for (const listener of writingListeners) listener();
}
export function useWriting(): ReadonlySet<string> {
  useSyncExternalStore(
    (listener) => {
      writingListeners.add(listener);
      return () => writingListeners.delete(listener);
    },
    () => writingVersion,
    () => writingVersion,
  );
  return writing;
}
