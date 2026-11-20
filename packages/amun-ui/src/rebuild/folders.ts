// The sidebar's lists, laid out the way ChatGPT lays out chats (owner, 20
// November 2026): "Your work" has one folder per piece of work with its chats
// under it, and "Chats" lists the chats that belong to no folder (the standing
// conversation with Firstmate, once called General).
import { generalConversationName } from "../../../../packages/domain/src/work/model.ts";
import {
  chatsOf,
  type FolderChat,
} from "../../../../packages/domain/src/work/chats.ts";

export type { FolderChat };

/** How many folders the sidebar lists before "See all" (Portfolio has the rest). */
export const folderLimit = 6;
/** How many chats a folder lists before "See more". */
export const chatLimit = 5;

export interface WorkFolder {
  areaId: string;
  name: string;
  /** Most recently used first. */
  chats: FolderChat[];
  /** Chats the owner archived: out of the list, kept, and can come back. */
  archived: FolderChat[];
}
/** A chat that belongs to no folder, with the work area that holds it. */
export interface LooseChat extends FolderChat {
  areaId: string;
}

interface Area {
  id: string;
  groupId: string | null;
  name: string;
  status: string;
  lastContextAt: string | null;
  createdAt: string;
  firstChat: { title: string | null; archivedAt: string | null };
}
type Chats = Parameters<typeof chatsOf>[1];
type Messages = Parameters<typeof chatsOf>[2];

/**
 * Work in the group being worked in, most recently used first, each with its
 * chats; and the chats that belong to no folder, newest first.
 */
export function workFolders(
  areas: readonly Area[],
  chats: Chats,
  messages: Messages,
  activeGroupId: string | null,
): {
  folders: WorkFolder[];
  loose: LooseChat[];
  looseArchived: LooseChat[];
  /** Where a new chat with no folder is started; null until one exists. */
  looseAreaId: string | null;
} {
  const used = (area: Area) => area.lastContextAt ?? area.createdAt;
  const shown = areas
    .filter(
      (area) =>
        area.status !== "deleted" &&
        (!activeGroupId || !area.groupId || area.groupId === activeGroupId),
    )
    .sort(
      (a, b) => used(b).localeCompare(used(a)) || a.name.localeCompare(b.name),
    );
  const folder = (area: Area): WorkFolder => {
    const all = chatsOf(area, chats, messages);
    return {
      areaId: area.id,
      name: area.name,
      chats: all.filter((chat) => chat.archivedAt === null),
      archived: all.filter((chat) => chat.archivedAt !== null),
    };
  };
  const general = shown.filter((area) => area.name === generalConversationName);
  const everyLoose = general
    .flatMap((area) =>
      chatsOf(area, chats, messages).map((chat) => ({
        ...chat,
        areaId: area.id,
      })),
    )
    // A standing conversation nobody has written in is not a chat to list.
    .filter((chat) => !(chat.kind === "first" && chat.empty))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return {
    folders: shown
      .filter((area) => area.name !== generalConversationName)
      .map(folder),
    loose: everyLoose.filter((chat) => chat.archivedAt === null),
    looseArchived: everyLoose.filter((chat) => chat.archivedAt !== null),
    looseAreaId: general[0]?.id ?? null,
  };
}
