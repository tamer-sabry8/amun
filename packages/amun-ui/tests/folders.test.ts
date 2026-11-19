import { expect, it } from "vitest";
import { workFolders } from "../src/rebuild/folders.ts";
import { forkNote, forkPoint } from "../src/rebuild/fork.ts";

const area = (
  id: string,
  name: string,
  lastContextAt: string | null,
  groupId: string | null = "work",
  status = "active",
) => ({
  id,
  name,
  groupId,
  status,
  lastContextAt,
  createdAt: "2026-11-01T00:00:00Z",
});

it("lists each piece of work under its own name, most recently used first, with General apart", () => {
  const { folders, general } = workFolders(
    [
      area("a", "MoCA Ecabinet", "2026-11-18T10:00:00Z"),
      area("b", "Dubai pilot", "2026-11-19T10:00:00Z"),
      area("c", "Chat with Firstmate", "2026-11-19T12:00:00Z"),
      area("d", "Personal errand", "2026-11-19T13:00:00Z", "personal"),
      area("e", "Old thing", "2026-11-19T14:00:00Z", "work", "deleted"),
    ],
    [
      {
        id: "f1",
        workAreaId: "a",
        title: "How many staff?",
        createdAt: "2026-11-18T11:00:00Z",
      },
      {
        id: "f2",
        workAreaId: "a",
        title: "Which tier?",
        createdAt: "2026-11-18T12:00:00Z",
      },
    ],
    "work",
  );
  expect(folders.map((folder) => folder.name)).toEqual([
    "Dubai pilot",
    "MoCA Ecabinet",
  ]);
  expect(folders[1]!.chats).toEqual([
    { chatId: null, title: "Main chat" },
    { chatId: "f2", title: "Which tier?" },
    { chatId: "f1", title: "How many staff?" },
  ]);
  expect(general.map((folder) => folder.areaId)).toEqual(["c"]);
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
