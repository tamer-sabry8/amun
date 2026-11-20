// The sidebar's three views of the same chats (owner's chat handoff, 20
// November 2026): Recent, Folders and General. Ordering follows only the
// owner's own sent messages, so reading a chat, crew activity and incoming
// replies never move anything. Pinned chats lead Recent in the owner's order.

import { unnamedChat } from "./chats.ts";

interface Area {
  id: string;
  groupId: string | null;
  name: string;
  status: string;
  createdAt: string;
  firstChat: {
    title: string | null;
    archivedAt: string | null;
    pinOrder?: number | null | undefined;
  };
}
interface Message {
  id: string;
  workAreaId: string;
  role: string;
  createdAt: string;
  readAt?: string | null | undefined;
}
interface Chat {
  id: string;
  workAreaId: string;
  title: string;
  archivedAt: string | null;
  createdAt: string;
  pinOrder?: number | null | undefined;
  messages: readonly Message[];
}

/** One chat as every list shows it. */
export interface ChatEntry {
  /** `${areaId}:${chatId ?? "first"}`, stable while the chat stays put. */
  key: string;
  areaId: string;
  /** Null is the work's first chat. */
  chatId: string | null;
  title: string;
  /** The folder's name; null for a chat in General. */
  folder: string | null;
  archived: boolean;
  pinOrder: number | null;
  /** When the owner last sent a message in it; null if never. */
  lastSentAt: string | null;
  /** What orders it: the owner's last message, or when the chat began. */
  sortAt: string;
  /** Replies from Firstmate the owner has not seen. */
  unread: number;
  /** The first of them, where "Open reply" lands. */
  firstUnreadId: string | null;
  empty: boolean;
}
export interface FolderEntry {
  areaId: string;
  name: string;
  /** The owner's last message anywhere in it, or when it was made. */
  sortAt: string;
  /** Any reply in any of its chats still unread. */
  unread: boolean;
  /** Its chats, the owner's latest first, archived ones left out. */
  chats: ChatEntry[];
  archived: ChatEntry[];
}
export interface ChatLists {
  /** Pinned chats in the owner's order, then the rest by last message. */
  recent: ChatEntry[];
  folders: FolderEntry[];
  /** Chats with no folder, by last message. */
  general: ChatEntry[];
  generalArchived: ChatEntry[];
  /** Every chat, archived ones included, by key. */
  byKey: Map<string, ChatEntry>;
}

export const chatKey = (areaId: string, chatId: string | null) =>
  `${areaId}:${chatId ?? "first"}`;

const newest = (a: { sortAt: string }, b: { sortAt: string }) =>
  b.sortAt.localeCompare(a.sortAt);

function entry(
  area: Area,
  chatId: string | null,
  title: string | null,
  archivedAt: string | null,
  pinOrder: number | null | undefined,
  createdAt: string,
  messages: readonly Message[],
  general: boolean,
): ChatEntry {
  const sent = messages.filter((message) => message.role === "you");
  const unread = messages.filter(
    (message) => message.role === "firstmate" && message.readAt === null,
  );
  const lastSentAt = sent.at(-1)?.createdAt ?? null;
  return {
    key: chatKey(area.id, chatId),
    areaId: area.id,
    chatId,
    title: title || unnamedChat,
    folder: general ? null : area.name,
    archived: archivedAt !== null,
    pinOrder: pinOrder ?? null,
    lastSentAt,
    // A chat Firstmate started (a reply nobody asked for) sorts by when it
    // began, and later replies never move it.
    sortAt: lastSentAt ?? messages[0]?.createdAt ?? createdAt,
    unread: unread.length,
    firstUnreadId: unread[0]?.id ?? null,
    empty: messages.length === 0,
  };
}

/**
 * Builds the three lists for the group being worked in. `generalName` is the
 * work that holds chats with no folder.
 */
export function chatLists(
  areas: readonly Area[],
  chats: readonly Chat[],
  /** Every work's first-chat messages. */
  messages: readonly Message[],
  activeGroupId: string | null,
  generalName: string,
): ChatLists {
  const shown = areas.filter(
    (area) =>
      area.status !== "deleted" &&
      (!activeGroupId || !area.groupId || area.groupId === activeGroupId),
  );
  const byKey = new Map<string, ChatEntry>();
  const folders: FolderEntry[] = [];
  const general: ChatEntry[] = [];
  for (const area of shown) {
    const isGeneral = area.name === generalName;
    const own = chats.filter((chat) => chat.workAreaId === area.id);
    const first = messages.filter((message) => message.workAreaId === area.id);
    const list: ChatEntry[] = own.map((chat) =>
      entry(
        area,
        chat.id,
        chat.title,
        chat.archivedAt,
        chat.pinOrder,
        chat.createdAt,
        chat.messages,
        isGeneral,
      ),
    );
    if (first.length || area.firstChat.title !== null)
      list.push(
        entry(
          area,
          null,
          area.firstChat.title,
          area.firstChat.archivedAt,
          area.firstChat.pinOrder,
          area.createdAt,
          first,
          isGeneral,
        ),
      );
    for (const item of list) byKey.set(item.key, item);
    // A chat nobody has written in is a draft, not a row.
    const used = list.filter((item) => !item.empty).sort(newest);
    if (isGeneral) {
      general.push(...used);
      continue;
    }
    const sent = used
      .map((item) => item.lastSentAt)
      .filter((at): at is string => at !== null)
      .sort()
      .at(-1);
    folders.push({
      areaId: area.id,
      name: area.name,
      sortAt: sent ?? area.createdAt,
      unread: used.some((item) => item.unread > 0 && !item.archived),
      chats: used.filter((item) => !item.archived),
      archived: used.filter((item) => item.archived),
    });
  }
  folders.sort((a, b) => newest(a, b) || a.name.localeCompare(b.name));
  general.sort(newest);
  const open = [...byKey.values()].filter(
    (item) => !item.empty && !item.archived,
  );
  const pinned = open
    .filter((item) => item.pinOrder !== null)
    .sort((a, b) => a.pinOrder! - b.pinOrder! || newest(a, b));
  const rest = open.filter((item) => item.pinOrder === null).sort(newest);
  return {
    recent: [...pinned, ...rest],
    folders,
    general: general.filter((item) => !item.archived),
    generalArchived: general.filter((item) => item.archived),
    byKey,
  };
}

/**
 * The order value that puts a pin at `index` among the pinned chats, which
 * are listed in `pinned` order. Moving never renumbers the others.
 */
export function pinOrderAt(
  pinned: readonly { pinOrder: number | null }[],
  index: number,
): number {
  const orders = pinned.map((item) => item.pinOrder ?? 0);
  if (!orders.length) return 1;
  if (index <= 0) return orders[0]! - 1;
  if (index >= orders.length) return orders.at(-1)! + 1;
  return (orders[index - 1]! + orders[index]!) / 2;
}
