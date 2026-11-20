import { describe, expect, it } from "vitest";
import { openWorkStore } from "../src/index.ts";
import { recordFirstMateReply } from "../src/first-mate-thread.ts";

const standing = "Chat with Firstmate";

function opened() {
  const work = openWorkStore(":memory:");
  work.store.handle({
    version: 1,
    kind: "work",
    action: "add-group",
    name: "Work",
  });
  return work;
}

function threadOf(work: ReturnType<typeof opened>, areaId: string) {
  return work.store
    .snapshot()
    .messages.filter((message) => message.workAreaId === areaId);
}

describe("a First Mate reply nobody asked for", () => {
  it("is kept in the standing conversation, made when there is none yet", () => {
    const work = opened();
    const id = recordFirstMateReply(
      work.store,
      "Standup is ready.",
      "pi/model",
    );
    expect(id).toEqual(expect.any(String));
    const areas = work.store
      .snapshot()
      .areas.filter((area) => area.name === standing);
    expect(areas).toHaveLength(1);
    const thread = threadOf(work, areas[0]!.id);
    expect(thread.map((message) => [message.role, message.text])).toEqual([
      ["firstmate", "Standup is ready."],
    ]);
    work.close();
  });

  it("goes to the existing conversation instead of making another", () => {
    const work = opened();
    recordFirstMateReply(work.store, "First.");
    recordFirstMateReply(work.store, "Second.");
    const areas = work.store
      .snapshot()
      .areas.filter((area) => area.name === standing);
    expect(areas).toHaveLength(1);
    expect(threadOf(work, areas[0]!.id).map((message) => message.text)).toEqual(
      ["First.", "Second."],
    );
    work.close();
  });

  it("goes to General's most recent chat, and never into an archived one", () => {
    const work = opened();
    const act = (action: string, extra: object) =>
      (
        work.store
          .handle({ version: 1, kind: "work", action, ...extra })
          .find(
            (event) => (event as { kind?: string }).kind === "work-result",
          ) as { ref: string | null }
      ).ref;
    recordFirstMateReply(work.store, "First.");
    const general = work.store
      .snapshot()
      .areas.find((area) => area.name === standing)!.id;
    const chat = act("new-chat", { workAreaId: general })!;
    act("message", {
      workAreaId: general,
      chatId: chat,
      role: "you",
      text: "A newer topic.",
    });
    recordFirstMateReply(work.store, "Heartbeat.");
    const texts = () =>
      work.store
        .snapshot()
        .chats.map((item) => item.messages.map((message) => message.text));
    expect(texts()).toEqual([["A newer topic.", "Heartbeat."]]);

    // Both chats archived: the reply starts a new chat.
    act("archive-chat", { workAreaId: general, chatId: chat, archived: true });
    act("archive-chat", { workAreaId: general, chatId: null, archived: true });
    recordFirstMateReply(work.store, "Later.");
    expect(texts()).toEqual([["A newer topic.", "Heartbeat."], ["Later."]]);
    expect(threadOf(work, general).map((message) => message.text)).toEqual([
      "First.",
    ]);
    work.close();
  });

  it("is cut to the store's limit rather than lost", () => {
    const work = opened();
    const id = recordFirstMateReply(work.store, "x".repeat(20_000));
    expect(id).toEqual(expect.any(String));
    const kept = work.store
      .snapshot()
      .messages.find((message) => message.id === id);
    expect(kept?.text.length).toBeLessThanOrEqual(16384);
    work.close();
  });

  it("is not kept when there is no group to put it in", () => {
    const work = openWorkStore(":memory:");
    expect(recordFirstMateReply(work.store, "Hello.")).toBeNull();
    work.close();
  });
});
