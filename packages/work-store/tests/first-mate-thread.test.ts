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

  it("raises a revised plan again when only its fields changed", () => {
    const work = opened();
    recordFirstMateReply(work.store, plan("Invoiced plan for Linear"));
    recordFirstMateReply(
      work.store,
      plan("Invoiced plan for Linear").replaceAll(
        '"team":"TRA"',
        '"team":"TRB"',
      ),
    );
    expect(
      work.store
        .snapshot()
        .plans.filter((item) => item.destination === "linear"),
    ).toHaveLength(2);
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

  it("deduplicates plans per request_ref so two requests with identical payloads produce two proposals and replaying one produces no third", () => {
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
    const req1 = "amun-r-111111111111";
    const req2 = "amun-r-222222222222";
    const m1 = act("message", {
      workAreaId: invoiced,
      role: "you",
      text: "First request for Linear plan.",
      card: { kind: "request", ref: req1 },
    })!;
    act("register-request", {
      ref: req1,
      messageId: m1,
      projectAreaId: invoiced,
    });
    const m2 = act("message", {
      workAreaId: invoiced,
      role: "you",
      text: "Second request for Linear plan.",
      card: { kind: "request", ref: req2 },
    })!;
    act("register-request", {
      ref: req2,
      messageId: m2,
      projectAreaId: invoiced,
    });

    const planFor = (ref: string) =>
      plan("Invoiced plan").replace(
        '"do":"plan",',
        `"do":"plan","request":"${ref}",`,
      );

    recordFirstMateReply(work.store, planFor(req1));
    recordFirstMateReply(work.store, planFor(req2));
    expect(
      work.store
        .snapshot()
        .plans.filter((item) => item.summary === "Invoiced plan"),
    ).toHaveLength(2);

    // Replaying req1's exact payload produces no third proposal.
    recordFirstMateReply(work.store, planFor(req1));
    expect(
      work.store
        .snapshot()
        .plans.filter((item) => item.summary === "Invoiced plan"),
    ).toHaveLength(2);

    // A legitimate revision of req1 remains reviewable.
    recordFirstMateReply(
      work.store,
      planFor(req1).replaceAll('"team":"TRA"', '"team":"TRB"'),
    );
    expect(
      work.store
        .snapshot()
        .plans.filter((item) => item.summary === "Invoiced plan"),
    ).toHaveLength(3);
    work.close();
  });

  it("refuses a plan with an explicit unknown request reference without creating a proposal", () => {
    const work = opened();
    const withUnknownRef = plan("Unknown request plan").replace(
      '"do":"plan",',
      '"do":"plan","request":"amun-r-cccccccccccc",',
    );
    recordFirstMateReply(work.store, withUnknownRef);
    expect(work.store.snapshot().plans).toHaveLength(0);

    const withMalformedRef = plan("Malformed request plan").replace(
      '"do":"plan",',
      '"do":"plan","request":"not-a-valid-ref",',
    );
    recordFirstMateReply(work.store, withMalformedRef);
    expect(work.store.snapshot().plans).toHaveLength(0);

    const general = work.store
      .snapshot()
      .areas.find((area) => area.name === standing)!;
    const refused = threadOf(work, general.id).filter(
      (message) =>
        (message.card as { kind?: string } | null)?.kind === "plan-refused",
    );
    expect(refused).toHaveLength(2);
    work.close();
  });

  it("strips raw amun blocks before fallback-saving when apply-reply fails", () => {
    const work = opened();
    // Exceeds apply-reply's 200,000-char command limit so apply-reply fails
    // validation and recordFirstMateReply falls back to saving the visible prose.
    const hugeDoc =
      "Here is the summary.\n\n```amun\n" +
      JSON.stringify({
        do: "document",
        title: "Huge",
        type: "doc",
        body: "a".repeat(205_000),
      }) +
      "\n```";
    const savedId = recordFirstMateReply(work.store, hugeDoc);
    expect(savedId).toEqual(expect.any(String));
    const general = work.store
      .snapshot()
      .areas.find((area) => area.name === standing)!;
    const saved = threadOf(work, general.id).find((m) => m.id === savedId);
    expect(saved?.text).toBe("Here is the summary.");
    expect(saved?.text).not.toContain("```amun");
    expect(saved?.text).not.toContain('"do":"document"');
    work.close();
  });
});
