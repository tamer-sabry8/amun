import { describe, expect, it } from "vitest";
import { chatsOf, latestOpenChat, unnamedChat } from "../src/work/chats.ts";

const area = (
  title: string | null = null,
  archivedAt: string | null = null,
) => ({
  id: "a1",
  firstChat: { title, archivedAt },
  createdAt: "2026-11-20T08:00:00Z",
});
const chat = (
  id: string,
  said: string[],
  extra: Partial<{ title: string; archivedAt: string | null }> = {},
) => ({
  id,
  workAreaId: "a1",
  title: "",
  kind: "chat" as const,
  archivedAt: null,
  createdAt: "2026-11-20T09:00:00Z",
  messages: said.map((createdAt) => ({ createdAt })),
  ...extra,
});
const first = (...said: string[]) =>
  said.map((createdAt) => ({ workAreaId: "a1", createdAt }));

describe("the chats inside a folder", () => {
  it("always has a chat to write in", () => {
    expect(chatsOf(area(), [], [])).toEqual([
      {
        chatId: null,
        title: unnamedChat,
        kind: "first",
        archivedAt: null,
        lastAt: "2026-11-20T08:00:00Z",
        empty: true,
      },
    ]);
  });

  it("lists the most recently used chat first, under its own name", () => {
    const listed = chatsOf(
      area("Plan the booth"),
      [
        chat("c1", ["2026-11-20T10:00:00Z"], { title: "Sponsors" }),
        chat("c2", []),
        chat("other", ["2026-11-20T12:00:00Z"], { title: "Elsewhere" }),
      ].map((item) =>
        item.id === "other" ? { ...item, workAreaId: "a2" } : item,
      ),
      [
        ...first("2026-11-20T08:30:00Z", "2026-11-20T11:00:00Z"),
        { workAreaId: "a2", createdAt: "2026-11-20T13:00:00Z" },
      ],
    );
    expect(listed.map((item) => [item.chatId, item.title])).toEqual([
      [null, "Plan the booth"],
      ["c1", "Sponsors"],
      ["c2", unnamedChat],
    ]);
  });

  it("leaves out a first chat that was never used once others exist", () => {
    expect(
      chatsOf(area(), [chat("c1", [])], []).map((item) => item.chatId),
    ).toEqual(["c1"]);
  });

  it("sends a message with no chat to the latest one that is not archived", () => {
    const chats = [
      chat("c1", ["2026-11-20T12:00:00Z"], {
        archivedAt: "2026-11-20T12:30:00Z",
      }),
      chat("c2", ["2026-11-20T10:00:00Z"]),
    ];
    expect(
      latestOpenChat(area("First"), chats, first("2026-11-20T09:00:00Z")),
    ).toBe("c2");
    expect(
      latestOpenChat(area("First"), [], first("2026-11-20T09:00:00Z")),
    ).toBe(null);
    // Every chat archived: the caller starts a new one.
    expect(
      latestOpenChat(
        area("First", "2026-11-20T13:00:00Z"),
        [chats[0]!],
        first("2026-11-20T09:00:00Z"),
      ),
    ).toBeUndefined();
  });
});
