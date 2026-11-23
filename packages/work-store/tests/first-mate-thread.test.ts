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

describe("a plan in a First Mate reply nobody asked for (handoff item 9)", () => {
  const plan = (summary: string) =>
    "I've asked Amun to raise the Invoiced plan for Linear for your approval.\n\n```amun\n" +
    JSON.stringify({
      do: "plan",
      planKind: "stories",
      destination: "linear",
      summary,
      items: [
        {
          summary: "Customers & contacts",
          fields: { type: "Epic", team: "TRA", site: "transfrm" },
        },
        {
          summary: "Add a customer",
          fields: {
            type: "Story",
            team: "TRA",
            parent: "Customers & contacts",
          },
        },
      ],
    }) +
    "\n```";

  it("is raised for approval, once, even when the same reply arrives again", () => {
    const work = opened();
    recordFirstMateReply(
      work.store,
      plan("Invoiced plan for Linear"),
      "pi/model",
    );
    recordFirstMateReply(
      work.store,
      plan("Invoiced plan for Linear"),
      "pi/model",
    );
    const plans = work.store
      .snapshot()
      .plans.filter((item) => item.destination === "linear");
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      state: "proposed",
      summary: "Invoiced plan for Linear",
    });
    expect(plans[0]!.items.map((item) => item.summary)).toEqual([
      "Customers & contacts",
      "Add a customer",
    ]);
    const general = work.store
      .snapshot()
      .areas.find((area) => area.name === standing)!;
    expect(threadOf(work, general.id).map((message) => message.text)).toEqual([
      "I've asked Amun to raise the Invoiced plan for Linear for your approval.",
      "I've asked Amun to raise the Invoiced plan for Linear for your approval.",
    ]);
    work.close();
  });

  it("goes to the chat of the request it names", () => {
    const work = opened();
    const act = (action: string, extra: object) =>
      (
        work.store
          .handle({ version: 1, kind: "work", action, ...extra })
          .find(
            (event) => (event as { kind?: string }).kind === "work-result",
          ) as { ref: string | null }
      ).ref;
    const group = work.store.snapshot().groups[0]!.id;
    const invoiced = act("create-area", {
      groupId: group,
      type: "project",
      name: "Invoiced",
    })!;
    const ref = "amun-r-aaaaaaaaaaaa";
    const messageId = act("message", {
      workAreaId: invoiced,
      role: "you",
      text: "Publish the epics to Linear.",
      card: { kind: "request", ref },
    })!;
    act("register-request", { ref, messageId, projectAreaId: invoiced });
    const text = plan("Invoiced plan").replace(
      '"do":"plan",',
      `"do":"plan","request":"${ref}",`,
    );
    recordFirstMateReply(work.store, text);
    const raised = work.store
      .snapshot()
      .plans.find((item) => item.summary === "Invoiced plan");
    expect(raised?.workAreaId).toBe(invoiced);
    work.close();
  });

  it("is not raised by a reply to the owner's own message (the window raises those)", () => {
    const work = opened();
    const group = work.store.snapshot().groups[0]!.id;
    const area = (
      work.store
        .handle({
          version: 1,
          kind: "work",
          action: "create-area",
          groupId: group,
          type: "project",
          name: "Gitex",
        })
        .find(
          (event) => (event as { kind?: string }).kind === "work-result",
        ) as { ref: string }
    ).ref;
    work.store.handle({
      version: 1,
      kind: "work",
      action: "apply-reply",
      text: plan("Window plan"),
      workAreaId: area,
      chatId: null,
      saveText: true,
    });
    expect(work.store.snapshot().plans).toHaveLength(0);
    work.close();
  });
});
