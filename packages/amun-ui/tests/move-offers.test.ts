import { describe, expect, it } from "vitest";
import {
  anotherName,
  asMoveOffer,
  findMoveOffer,
  moveCardId,
  moveQuestion,
  moveRef,
  sendAsTyped,
  takeAsTyped,
  type MoveOffer,
} from "../src/rebuild/move-offers.ts";
import { islandItem } from "../../domain/src/work/home.ts";
import { parseAmunActions } from "../src/rebuild/view-model.ts";

const offer = (extra: Partial<MoveOffer> = {}): MoveOffer => ({
  kind: "move-offer",
  state: "open",
  held: "Create a new product called Amun-SDK",
  fromMessageId: null,
  request: { type: "product", name: "Amun-SDK", priority: null, dueDate: null },
  existingAreaId: null,
  workAreaId: "gitex",
  chatId: null,
  ...extra,
});

describe("asking where a message goes", () => {
  it("asks about a held message in plain words, with the name to change", () => {
    expect(moveQuestion(offer(), "Gitex", null)).toEqual({
      label: "Question",
      title: "This looks like a new product",
      detail:
        "“Amun-SDK” is not part of Gitex. Your message has not been sent yet.",
      nameField: true,
      buttons: [
        { choice: "new", label: "Move to a new folder" },
        { choice: "keep", label: "Keep it in Gitex" },
      ],
      note: "Nothing is sent until you choose",
    });
  });

  it("words a suggestion about sent messages as one", () => {
    const asked = moveQuestion(
      offer({ held: null, fromMessageId: "m3" }),
      "Gitex",
      null,
    );
    expect(asked.label).toBe("Suggestion");
    expect(asked.title).toBe("This may belong in its own folder");
    expect(asked.buttons.map((button) => button.label)).toEqual([
      "Move them to a new folder",
      "Keep them in Gitex",
    ]);
    expect(asked.note).toBe("Nothing moves unless you say so");
  });

  it("offers the folder that already has the name first", () => {
    const asked = moveQuestion(
      offer({ existingAreaId: "a1" }),
      "Chat with Firstmate",
      "Gitex",
    );
    expect(asked.title).toBe("You already have a folder called Gitex");
    expect(asked.nameField).toBe(false);
    expect(asked.buttons).toEqual([
      { choice: "existing", label: "Open Gitex" },
      { choice: "another", label: "Create another" },
      { choice: "keep", label: "Keep it here" },
    ]);
  });

  it("finds the offer behind a question in any chat", () => {
    const snapshot = {
      messages: [{ id: "m1", card: null }],
      chats: [{ messages: [{ id: "m2", card: offer() }] }],
    };
    expect(moveCardId(moveRef("m2"))).toBe("m2");
    expect(findMoveOffer(snapshot, moveRef("m2"))?.request.name).toBe(
      "Amun-SDK",
    );
    expect(findMoveOffer(snapshot, moveRef("m1"))).toBeNull();
    expect(findMoveOffer(snapshot, "plan:m2")).toBeNull();
    expect(asMoveOffer({ kind: "move-offer" })).toBeNull();
  });

  it("names another folder without taking a name in use", () => {
    expect(anotherName("Gitex", ["Gitex", "gitex 2"])).toBe("Gitex 3");
  });

  it("sends a kept message as typed exactly once", () => {
    sendAsTyped(" Create a new product called Amun-SDK ");
    expect(takeAsTyped("Create a new product called Amun-SDK")).toBe(true);
    expect(takeAsTyped("Create a new product called Amun-SDK")).toBe(false);
  });

  it("is asked on Firstmate's card even while its own chat is open", () => {
    const item = (id: string, ref: string | null) => ({
      id,
      kind: "question" as const,
      groupName: null,
      workAreaId: "gitex",
      workAreaName: "Gitex",
      title: id,
      detail: "",
      state: "open" as const,
      createdAt: "2026-11-20T08:00:00Z",
      ref,
    });
    const shown = islandItem(
      [item("plain", null), item("move", moveRef("m2"))],
      "gitex",
    );
    expect(shown).toMatchObject({ top: { id: "move" }, count: 1, held: 1 });
  });
});

describe("Firstmate suggesting a move", () => {
  it("is read from its reply and never shown as text", () => {
    const parsed = parseAmunActions(
      'Three tiers usually work.\n```amun\n{"do":"move","name":"Amun-SDK","type":"product","messages":2}\n```',
    );
    expect(parsed.text).toBe("Three tiers usually work.");
    expect(parsed.actions).toEqual([
      { do: "move", name: "Amun-SDK", type: "product", messages: 2 },
    ]);
  });

  it("falls back to safe values, and ignores one with no name", () => {
    expect(
      parseAmunActions(
        '```amun\n{"do":"move","name":"X","type":"galaxy","messages":-3}\n```',
      ).actions,
    ).toEqual([{ do: "move", name: "X", type: "project", messages: 1 }]);
    expect(parseAmunActions('```amun\n{"do":"move"}\n```').actions).toEqual([]);
  });
});
