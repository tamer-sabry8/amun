// The chats inside one folder (a piece of work, or General). Every folder
// holds ordinary chats the owner can add to, rename and archive (owner, 20
// November 2026). A work's first chat has no row of its own: its messages
// carry no chat id, and its name and archive mark live on the work.

/** What a chat with no name yet is called. */
export const unnamedChat = "New chat";

interface Area {
  id: string;
  firstChat: { title: string | null; archivedAt: string | null };
  createdAt: string;
}
interface Chat {
  id: string;
  workAreaId: string;
  title: string;
  kind: "fork" | "chat";
  archivedAt: string | null;
  createdAt: string;
  messages: readonly { createdAt: string }[];
}
interface Message {
  workAreaId: string;
  createdAt: string;
}

export interface FolderChat {
  /** Null is the work's first chat. */
  chatId: string | null;
  title: string;
  kind: "first" | "fork" | "chat";
  archivedAt: string | null;
  /** When something was last said in it; when it was made, if nothing was. */
  lastAt: string;
  empty: boolean;
}

/**
 * Every chat of one work, most recently used first, archived ones included.
 * The first chat is listed while it has been used, or while it is the only
 * chat there is, so a folder is never without a chat to write in.
 */
export function chatsOf(
  area: Area,
  chats: readonly Chat[],
  /** Every work's first-chat messages, as the snapshot holds them. */
  messages: readonly Message[],
): FolderChat[] {
  const own = chats.filter((chat) => chat.workAreaId === area.id);
  const first = messages.filter((message) => message.workAreaId === area.id);
  const listed: FolderChat[] = own.map((chat) => ({
    chatId: chat.id,
    title: chat.title || unnamedChat,
    kind: chat.kind,
    archivedAt: chat.archivedAt,
    lastAt: chat.messages.at(-1)?.createdAt ?? chat.createdAt,
    empty: chat.messages.length === 0,
  }));
  if (first.length || area.firstChat.title !== null || !own.length)
    listed.push({
      chatId: null,
      title: area.firstChat.title ?? unnamedChat,
      kind: "first",
      archivedAt: area.firstChat.archivedAt,
      lastAt: first.at(-1)?.createdAt ?? area.createdAt,
      empty: first.length === 0,
    });
  return listed.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/**
 * The chat a message with no chat of its own goes to: the one used most
 * recently that is not archived. `undefined` when every chat is archived, so
 * the caller starts a new one rather than writing into an archived chat.
 */
export function latestOpenChat(
  area: Area,
  chats: readonly Chat[],
  messages: readonly Message[],
): string | null | undefined {
  const open = chatsOf(area, chats, messages).find(
    (chat) => chat.archivedAt === null,
  );
  return open ? open.chatId : undefined;
}
