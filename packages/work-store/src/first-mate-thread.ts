// Where a First Mate reply nobody asked for is kept: General's most recent
// chat, the one the Home chat already uses.
import { generalConversationName } from "../../domain/src/work/model.ts";
import { latestOpenChat } from "../../domain/src/work/chats.ts";
import type { WorkSnapshot } from "../../contracts/src/work.ts";

/** The part of the work store this needs. */
export interface FirstMateThreadStore {
  snapshot(): WorkSnapshot;
  handle(input: unknown): unknown[];
}

/** The work store's limit on one message. */
const MESSAGE_LIMIT = 16384;

interface WorkResult {
  kind?: unknown;
  ok?: unknown;
  ref?: unknown;
}

function resultOf(events: unknown[]): WorkResult | null {
  const found = events.find(
    (event) =>
      typeof event === "object" &&
      event !== null &&
      (event as WorkResult).kind === "work-result",
  );
  return (found as WorkResult | undefined) ?? null;
}

/**
 * Saves a First Mate reply that Amun did not ask for (a heartbeat, a wake) in
 * General. The General used most recently wins, and inside it the chat used
 * most recently that is not archived; with every chat archived a new one is
 * started. With no General yet, one is made in the first group, as Home does.
 * Returns the message id, or null when there is no group to put it in.
 */
export function recordFirstMateReply(
  store: FirstMateThreadStore,
  text: string,
  model: string | null = null,
): string | null {
  const snapshot = store.snapshot();
  const standing = [...snapshot.areas]
    .filter((area) => area.name === generalConversationName)
    .sort((a, b) =>
      String(b.lastContextAt ?? "").localeCompare(
        String(a.lastContextAt ?? ""),
      ),
    )[0];
  let areaId = standing?.id ?? null;
  // A General that was just made has only its first chat.
  let chatId: string | null | undefined = standing
    ? latestOpenChat(standing, snapshot.chats, snapshot.messages)
    : null;
  if (!areaId) {
    const group = [...snapshot.groups].sort(
      (a, b) => a.position - b.position,
    )[0];
    if (!group) return null;
    const created = resultOf(
      store.handle({
        version: 1,
        kind: "work",
        action: "create-area",
        groupId: group.id,
        type: "task",
        name: generalConversationName,
      }),
    );
    if (created?.ok !== true || typeof created.ref !== "string") return null;
    areaId = created.ref;
  }
  if (chatId === undefined) {
    const started = resultOf(
      store.handle({
        version: 1,
        kind: "work",
        action: "new-chat",
        workAreaId: areaId,
      }),
    );
    if (started?.ok !== true || typeof started.ref !== "string") return null;
    chatId = started.ref;
  }
  const trimmed =
    text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT - 1)}…` : text;
  const saved = resultOf(
    store.handle({
      version: 1,
      kind: "work",
      action: "message",
      workAreaId: areaId,
      chatId,
      role: "firstmate",
      text: trimmed,
      model,
    }),
  );
  return saved?.ok === true && typeof saved.ref === "string" ? saved.ref : null;
}
