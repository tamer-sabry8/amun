import { expect, it } from "vitest";
import { workFolders } from "../src/rebuild/folders.ts";
import {
  chatNote,
  chatRecap,
  forkNote,
  forkPoint,
} from "../src/rebuild/fork.ts";

const area = (
  id: string,
  name: string,
  lastContextAt: string | null,
  groupId: string | null = "work",
  status = "active",
  firstChat: { title: string | null; archivedAt: string | null } = {
    title: null,
    archivedAt: null,
  },
) => ({
  id,
  name,
  groupId,
  status,
  lastContextAt,
  createdAt: "2026-11-01T00:00:00Z",
  firstChat,
});
const other = (
  id: string,
  workAreaId: string,
  title: string,
  said: string[],
  archivedAt: string | null = null,
) => ({
  id,
  workAreaId,
  title,
  kind: "chat" as const,
  archivedAt,
  createdAt: "2026-11-18T09:00:00Z",
  messages: said.map((createdAt) => ({ createdAt })),
});

it("lists each piece of work with its chats, and the chats that have no folder apart", () => {
  const { folders, loose, looseArchived, looseAreaId } = workFolders(
    [
      area("a", "MoCA Ecabinet", "2026-11-18T10:00:00Z", "work", "active", {
        title: "Draft the PRD outline",
        archivedAt: null,
      }),
      area("b", "Dubai pilot", "2026-11-19T10:00:00Z"),
      area(
        "c",
        "Chat with Firstmate",
        "2026-11-19T12:00:00Z",
        "work",
        "active",
        {
          title: "What is on my plate?",
          archivedAt: null,
        },
      ),
      area("d", "Personal errand", "2026-11-19T13:00:00Z", "personal"),
      area("e", "Old thing", "2026-11-19T14:00:00Z", "work", "deleted"),
    ],
    [
      other("f1", "a", "How many staff?", ["2026-11-18T11:00:00Z"]),
      other("f2", "a", "", []),
      other(
        "f3",
        "a",
        "Old idea",
        ["2026-11-10T11:00:00Z"],
        "2026-11-11T00:00:00Z",
      ),
      other("g1", "c", "Monday standup", ["2026-11-19T15:00:00Z"]),
      other(
        "g2",
        "c",
        "Old question",
        ["2026-11-01T15:00:00Z"],
        "2026-11-02T00:00:00Z",
      ),
    ],
    [
      { workAreaId: "a", createdAt: "2026-11-18T12:00:00Z" },
      { workAreaId: "c", createdAt: "2026-11-19T12:00:00Z" },
    ],
    "work",
  );
  expect(folders.map((folder) => folder.name)).toEqual([
    "Dubai pilot",
    "MoCA Ecabinet",
  ]);
  // Most recently used first; a chat with no name yet is "New chat".
  expect(folders[1]!.chats.map((chat) => [chat.chatId, chat.title])).toEqual([
    [null, "Draft the PRD outline"],
    ["f1", "How many staff?"],
    ["f2", "New chat"],
  ]);
  expect(folders[1]!.archived.map((chat) => chat.chatId)).toEqual(["f3"]);
  // A folder nobody has written in still has a chat to open.
  expect(folders[0]!.chats).toHaveLength(1);
  expect(loose.map((chat) => [chat.areaId, chat.chatId, chat.title])).toEqual([
    ["c", "g1", "Monday standup"],
    ["c", null, "What is on my plate?"],
  ]);
  expect(looseArchived.map((chat) => chat.chatId)).toEqual(["g2"]);
  expect(looseAreaId).toBe("c");
});

it("lists no chat for a standing conversation nobody has written in", () => {
  const { loose, looseAreaId } = workFolders(
    [area("c", "Chat with Firstmate", null)],
    [],
    [],
    "work",
  );
  expect(loose).toEqual([]);
  expect(looseAreaId).toBe("c");
});

const chat = {
  id: "f1",
  title: "How many support staff?",
  fromChatId: null,
  createdAt: "2026-11-19T10:05:00Z",
  messages: [
    { role: "you", text: "Plan support.", createdAt: "2026-11-19T10:00:00Z" },
    {
      role: "firstmate",
      text: "How many support staff?",
      createdAt: "2026-11-19T10:01:00Z",
    },
  ],
};

it("tells Firstmate in full on a fork's first message, then only names the chat", () => {
  expect(forkPoint(chat)).toBe("2026-11-19T10:01:00Z");
  expect(forkNote(chat, chat.messages)).toMatch(
    /fork of this work area's main chat.*“How many support staff\?”.*set aside.*not undone/s,
  );
  const later = [
    ...chat.messages,
    { role: "you", text: "One.", createdAt: "2026-11-19T10:06:00Z" },
  ];
  expect(forkNote(chat, later)).toBe(
    "[Fork “How many support staff?” of this work area.]",
  );
});

it("tells Firstmate a new chat is a fresh topic, once, and names the others", () => {
  const first = chatNote("Sponsors", false, ["Plan the booth", "Travel"]);
  expect(first).toMatch(/new chat in this work area, on a fresh topic/);
  expect(first).toMatch(/“Plan the booth”, “Travel”/);
  expect(first).toMatch(/Do not bring in anything said in the other chats/);
  expect(chatNote("Sponsors", true, ["Plan the booth"])).toBe(
    "[Chat “Sponsors” of this work area.]",
  );
  expect(chatNote("Sponsors", false, [])).not.toMatch(/other chats are/);
});

it("recaps a chat for a Firstmate whose memory started fresh", () => {
  expect(chatRecap([])).toBe("");
  expect(chatRecap([{ role: "card", text: "A card" }])).toBe("");
  const recap = chatRecap([
    { role: "you", text: "Plan the\nbooth." },
    { role: "card", text: "A card" },
    { role: "firstmate", text: "Three zones." },
  ]);
  expect(recap).toContain("Owner: Plan the booth.\nYou: Three zones.");
  expect(recap).toContain("This is all of it.");
  const long = chatRecap(
    Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 ? "firstmate" : "you",
      text: `Message ${index} ` + "x".repeat(600),
    })),
  );
  expect(long).toContain("the last 8 of 12 messages");
  expect(long).not.toContain("Message 3 ");
  expect(long.length).toBeLessThan(4200);
});
