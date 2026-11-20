import { describe, expect, it } from "vitest";
import { chatLists, pinOrderAt } from "../src/work/chat-lists.ts";

const general = "Chat with Firstmate";
const area = (id: string, name: string, extra: object = {}) => ({
  id,
  groupId: "g",
  name,
  status: "active",
  createdAt: "2026-11-01T00:00:00Z",
  firstChat: { title: null, archivedAt: null, pinOrder: null },
  ...extra,
});
const msg = (
  id: string,
  workAreaId: string,
  role: "you" | "firstmate",
  at: string,
  readAt: string | null = at,
) => ({ id, workAreaId, role, createdAt: `2026-11-20T${at}:00Z`, readAt });
const chat = (
  id: string,
  workAreaId: string,
  title: string,
  messages: ReturnType<typeof msg>[],
  extra: object = {},
) => ({
  id,
  workAreaId,
  title,
  archivedAt: null,
  createdAt: "2026-11-10T00:00:00Z",
  pinOrder: null,
  messages,
  ...extra,
});

describe("chat lists", () => {
  const areas = [
    area("gitex", "Gitex"),
    area("amun", "Amun"),
    area("gen", general),
  ];
  const chats = [
    chat("budget", "gitex", "Budget notes", [
      msg("b1", "gitex", "you", "09:00"),
      // A late reply, unread, must not move the chat.
      msg("b2", "gitex", "firstmate", "12:00", null),
    ]),
    chat("venue", "gitex", "Venue booking", [
      msg("v1", "gitex", "you", "10:00"),
    ]),
    chat("risk", "gen", "Which RFPs are at risk?", [
      msg("r1", "gen", "you", "11:00"),
    ]),
    chat("draft", "gitex", "", []),
  ];
  const first = [msg("a1", "amun", "you", "08:00")];

  it("orders Recent by the owner's own last message, ignoring replies", () => {
    const lists = chatLists(areas, chats, first, "g", general);
    expect(lists.recent.map((item) => item.key)).toEqual([
      "gen:risk",
      "gitex:venue",
      "gitex:budget",
      "amun:first",
    ]);
  });

  it("puts pins first in the owner's order, each chat once", () => {
    const pinned = chats.map((item) =>
      item.id === "budget"
        ? { ...item, pinOrder: 2 }
        : item.id === "venue"
          ? { ...item, pinOrder: 1 }
          : item,
    );
    const lists = chatLists(areas, pinned, first, "g", general);
    expect(lists.recent.map((item) => item.key)).toEqual([
      "gitex:venue",
      "gitex:budget",
      "gen:risk",
      "amun:first",
    ]);
  });

  it("orders folders by the owner's last message and marks unread", () => {
    const lists = chatLists(areas, chats, first, "g", general);
    expect(lists.folders.map((item) => item.name)).toEqual(["Gitex", "Amun"]);
    const gitex = lists.folders[0]!;
    expect(gitex.unread).toBe(true);
    // The empty chat is a draft behind +, not a row.
    expect(gitex.chats.map((item) => item.title)).toEqual([
      "Venue booking",
      "Budget notes",
    ]);
    expect(lists.byKey.get("gitex:budget")).toMatchObject({
      unread: 1,
      firstUnreadId: "b2",
      folder: "Gitex",
    });
  });

  it("keeps General to chats with no folder", () => {
    const lists = chatLists(areas, chats, first, "g", general);
    expect(lists.general.map((item) => item.key)).toEqual(["gen:risk"]);
    expect(lists.byKey.get("gen:risk")!.folder).toBeNull();
  });

  it("leaves archived chats out of Recent and the folder's list", () => {
    const archived = chats.map((item) =>
      item.id === "venue"
        ? { ...item, archivedAt: "2026-11-20T12:00:00Z" }
        : item,
    );
    const lists = chatLists(areas, archived, first, "g", general);
    expect(lists.recent.some((item) => item.key === "gitex:venue")).toBe(false);
    expect(lists.folders[0]!.archived.map((item) => item.key)).toEqual([
      "gitex:venue",
    ]);
  });

  it("treats messages from older builds with no read mark as read", () => {
    const old = [
      {
        id: "o1",
        workAreaId: "amun",
        role: "firstmate",
        createdAt: "2026-11-01T00:00:00Z",
      },
    ];
    const lists = chatLists(areas, [], old, "g", general);
    expect(lists.byKey.get("amun:first")!.unread).toBe(0);
  });
});

describe("pin order", () => {
  const pins = [{ pinOrder: 1 }, { pinOrder: 2 }, { pinOrder: 4 }];
  it("places a pin before, between or after the others", () => {
    expect(pinOrderAt([], 0)).toBe(1);
    expect(pinOrderAt(pins, 0)).toBe(0);
    expect(pinOrderAt(pins, 2)).toBe(3);
    expect(pinOrderAt(pins, 3)).toBe(5);
  });
});
