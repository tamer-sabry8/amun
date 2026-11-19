// The folders in the sidebar: one per piece of work, under its own name, with
// its chats inside (the main chat, then its forks), and General last.
import { generalConversationName } from "../../../../packages/domain/src/work/model.ts";

/** How many folders the sidebar lists before "See all" (Portfolio has the rest). */
export const folderLimit = 6;
/** How many chats a folder lists before "See more". */
export const chatLimit = 5;

export interface FolderChat {
  /** Null is the work's main chat. */
  chatId: string | null;
  title: string;
}
export interface WorkFolder {
  areaId: string;
  name: string;
  chats: FolderChat[];
}

interface Area {
  id: string;
  groupId: string | null;
  name: string;
  status: string;
  lastContextAt: string | null;
  createdAt: string;
}
interface Chat {
  id: string;
  workAreaId: string;
  title: string;
  createdAt: string;
}

/**
 * Work in the group being worked in, most recently used first, each with its
 * chats; and what goes under General (the standing chat with Firstmate).
 */
export function workFolders(
  areas: readonly Area[],
  chats: readonly Chat[],
  activeGroupId: string | null,
): { folders: WorkFolder[]; general: WorkFolder[] } {
  const used = (area: Area) => area.lastContextAt ?? area.createdAt;
  const all = areas
    .filter(
      (area) =>
        area.status !== "deleted" &&
        (!activeGroupId || !area.groupId || area.groupId === activeGroupId),
    )
    .sort(
      (a, b) => used(b).localeCompare(used(a)) || a.name.localeCompare(b.name),
    )
    .map((area) => ({
      areaId: area.id,
      name: area.name,
      chats: [
        { chatId: null, title: "Main chat" } as FolderChat,
        // Newest fork first.
        ...chats
          .filter((chat) => chat.workAreaId === area.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((chat) => ({ chatId: chat.id, title: chat.title })),
      ],
    }));
  return {
    folders: all.filter((folder) => folder.name !== generalConversationName),
    general: all.filter((folder) => folder.name === generalConversationName),
  };
}
