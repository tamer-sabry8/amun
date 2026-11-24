import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../src/sqlite.ts";
import { migrate } from "../src/database.ts";
import { WorkStore } from "../src/work-store.ts";
import { recordFirstMateReply } from "../src/first-mate-thread.ts";

let db: Database;
let store: WorkStore;
let clock: number;

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
  clock = Date.parse("2026-11-24T09:00:00Z");
  store = new WorkStore(db, undefined, () => new Date((clock += 1000)));
});

function send(action: string, extra: Record<string, unknown> = {}) {
  const events = store.handle({ version: 1, kind: "work", action, ...extra });
  return events.find((event) => event.kind === "work-result") as unknown as {
    ok: boolean;
    ref: string | null;
    message: string;
  };
}

const snap = () => store.snapshot();
const block = (value: object) => "```amun\n" + JSON.stringify(value) + "\n```";

function setupGroups() {
  send("finish-setup", {
    workTypes: ["product", "project", "task", "rfp"],
    tools: [],
    agents: [],
    groups: [
      { name: "Work", routes: [] },
      { name: "Personal", routes: [] },
    ],
  });
  const workGroup = snap().groups.find((g) => g.name === "Work")!.id;
  const personalGroup = snap().groups.find((g) => g.name === "Personal")!.id;
  const gitex = send("create-area", {
    groupId: workGroup,
    type: "project",
    name: "Gitex",
  }).ref!;
  const amun = send("create-area", {
    groupId: workGroup,
    type: "product",
    name: "Amun",
  }).ref!;
  const home = send("create-area", {
    groupId: personalGroup,
    type: "project",
    name: "Home Reno",
  }).ref!;
  const general = send("create-area", {
    groupId: workGroup,
    type: "task",
    name: "Chat with Firstmate",
  }).ref!;
  return { workGroup, personalGroup, gitex, amun, home, general };
}

function ask(
  areaId: string,
  text: string,
  ref: string,
  chatId: string | null = null,
) {
  const id = send("message", {
    workAreaId: areaId,
    chatId,
    role: "you",
    text,
    card: { kind: "request", ref },
  }).ref!;
  expect(
    send("register-request", { ref, messageId: id, projectAreaId: areaId }).ok,
  ).toBe(true);
  return id;
}

const allMessages = () => [
  ...snap().messages,
  ...snap().chats.flatMap((chat) => chat.messages),
];

const deliveries = () =>
  allMessages().filter(
    (message) =>
      (message.card as { kind?: string } | null)?.kind === "delivered",
  );

describe("canonical library origin", () => {
  const req1 = "amun-r-111111111111";
  const req2 = "amun-r-222222222222";

  it("derives canonical origin for first chat and named chat deliveries", () => {
    const { gitex } = setupGroups();
    ask(gitex, "Draft the Gitex PRD.", req1, null);
    recordFirstMateReply(
      store,
      block({
        do: "document",
        request: req1,
        title: "Gitex PRD",
        type: "prd",
        body: "# PRD v1",
      }),
    );

    const namedChat = send("new-chat", { workAreaId: gitex }).ref!;
    ask(gitex, "Write launch checklist.", req2, namedChat);
    recordFirstMateReply(
      store,
      block({
        do: "document",
        request: req2,
        title: "Launch Checklist",
        type: "doc",
        body: "- Item 1",
      }),
    );

    const prdDoc = snap().library.find((item) => item.title === "Gitex PRD")!;
    const prdCard = deliveries().find(
      (m) => (m.card as { outputId?: string }).outputId === prdDoc.id,
    )!;
    expect(prdDoc.origin).toEqual({
      workAreaId: gitex,
      chatId: null,
      messageId: prdCard.id,
      requestRef: req1,
      version: 1,
    });

    const checklistDoc = snap().library.find(
      (item) => item.title === "Launch Checklist",
    )!;
    const checklistCard = deliveries().find(
      (m) => (m.card as { outputId?: string }).outputId === checklistDoc.id,
    )!;
    expect(checklistDoc.origin).toEqual({
      workAreaId: gitex,
      chatId: namedChat,
      messageId: checklistCard.id,
      requestRef: req2,
      version: 1,
    });
  });

  it("follows moved chats and preserves origin for archived chats", () => {
    const { gitex, amun } = setupGroups();
    const chatId = send("new-chat", { workAreaId: gitex }).ref!;
    ask(gitex, "Draft migration plan.", req1, chatId);
    recordFirstMateReply(
      store,
      block({
        do: "document",
        request: req1,
        title: "Migration Plan",
        type: "doc",
        body: "# Plan",
      }),
    );

    const cardBefore = deliveries()[0]!;
    // Move the chat to Amun (whose first chat is unused, so chatId becomes null).
    expect(
      send("move-chat", {
        workAreaId: gitex,
        chatId,
        toWorkAreaId: amun,
      }).ok,
    ).toBe(true);

    const docAfterMove = snap().library.find(
      (item) => item.title === "Migration Plan",
    )!;
    expect(docAfterMove.origin).toEqual({
      workAreaId: amun,
      chatId: null,
      messageId: cardBefore.id,
      requestRef: req1,
      version: 1,
    });

    // Archive a named chat that holds an origin delivery; origin stays intact.
    const archivedChat = send("new-chat", { workAreaId: gitex }).ref!;
    ask(gitex, "Write risk register.", req2, archivedChat);
    recordFirstMateReply(
      store,
      block({
        do: "document",
        request: req2,
        title: "Risk Register",
        type: "doc",
        body: "# Risks",
      }),
    );
    expect(
      send("archive-chat", {
        workAreaId: gitex,
        chatId: archivedChat,
        archived: true,
      }).ok,
    ).toBe(true);

    const riskDoc = snap().library.find(
      (item) => item.title === "Risk Register",
    )!;
    const riskCard = deliveries().find(
      (m) => (m.card as { outputId?: string }).outputId === riskDoc.id,
    )!;
    expect(riskDoc.origin).toEqual({
      workAreaId: gitex,
      chatId: archivedChat,
      messageId: riskCard.id,
      requestRef: req2,
      version: 1,
    });
  });

  it("never lets a fork-copied delivered card override an earlier origin, while allowing fork-authored origins", () => {
    const { gitex } = setupGroups();
    // Create a named chat (forked_from = '') and deliver v1 there.
    const namedChat = send("new-chat", { workAreaId: gitex }).ref!;
    ask(gitex, "Draft architecture doc.", req1, namedChat);
    recordFirstMateReply(
      store,
      block({
        do: "document",
        request: req1,
        title: "Architecture",
        type: "doc",
        body: "# Arch v1",
      }),
    );

    const originalCard = deliveries()[0]!;
    // Fork from the delivered card: fork-chat copies the delivered card with the exact same created_at.
    const forkId = send("fork-chat", {
      workAreaId: gitex,
      messageId: originalCard.id,
    }).ref!;

    const archDoc = snap().library.find(
      (item) => item.title === "Architecture",
    )!;
    // Canonical origin must remain the non-fork named chat, NOT the fork copy.
    expect(archDoc.origin).toEqual({
      workAreaId: gitex,
      chatId: namedChat,
      messageId: originalCard.id,
      requestRef: req1,
      version: 1,
    });

    // Now author a brand-new artifact directly inside the fork.
    ask(gitex, "Draft spike notes in this fork.", req2, forkId);
    recordFirstMateReply(
      store,
      block({
        do: "document",
        request: req2,
        title: "Fork Spike Notes",
        type: "doc",
        body: "# Spike",
      }),
    );

    const spikeDoc = snap().library.find(
      (item) => item.title === "Fork Spike Notes",
    )!;
    const spikeCard = snap()
      .chats.find((c) => c.id === forkId)!
      .messages.find(
        (m) =>
          (m.card as { outputId?: string } | null)?.outputId === spikeDoc.id,
      )!;
    expect(spikeDoc.origin).toEqual({
      workAreaId: gitex,
      chatId: forkId,
      messageId: spikeCard.id,
      requestRef: req2,
      version: 1,
    });
  });

  it("returns origin: null for deleted origin work area, manual outputs, records, and cross-group cards", () => {
    const { workGroup, gitex, home } = setupGroups();

    // 1. Deleted origin work area -> origin: null
    ask(gitex, "Write brief.", req1, null);
    recordFirstMateReply(
      store,
      block({
        do: "document",
        request: req1,
        title: "Ephemeral Brief",
        type: "doc",
        body: "# Brief",
      }),
    );
    expect(
      snap().library.find((item) => item.title === "Ephemeral Brief")?.origin,
    ).not.toBeNull();
    expect(send("delete-area", { areaId: gitex }).ok).toBe(true);
    expect(
      snap().library.find((item) => item.title === "Ephemeral Brief")?.origin,
    ).toBeNull();

    // 2. Manual output -> origin: null
    const manualId = send("save-output", {
      groupId: workGroup,
      type: "doc",
      title: "Manual Note",
      body: "Written by hand",
      status: "Draft",
      workAreaIds: [],
      author: "owner",
    }).ref!;
    expect(
      snap().library.find((item) => item.id === manualId)?.origin,
    ).toBeNull();

    // 3. Record -> origin: null
    const recordId = send("save-record", {
      groupId: workGroup,
      type: "idea",
      title: "Raw Idea",
      body: "An idea",
    }).ref!;
    expect(
      snap().library.find((item) => item.id === recordId)?.origin,
    ).toBeNull();

    // 4. Cross-group delivered card in Personal pointing at a Work output MUST NOT link as origin.
    send("message", {
      workAreaId: home,
      chatId: null,
      role: "card",
      text: "Manual Note",
      card: {
        kind: "delivered",
        outputId: manualId,
        title: "Manual Note",
        version: 1,
        request: null,
      },
    });
    expect(
      snap().library.find((item) => item.id === manualId)?.origin,
    ).toBeNull();
  });
});

describe("cross-request versioned revisions", () => {
  const req1 = "amun-r-aaaaaaaaaaaa";
  const req2 = "amun-r-bbbbbbbbbbbb";
  const req3 = "amun-r-cccccccccccc";
  const personalReq = "amun-r-dddddddddddd";

  it("revises v1 -> v2 across requests while retaining approvedVersion on v1 and canonical v1 origin", () => {
    const { gitex } = setupGroups();
    const chat1 = send("new-chat", { workAreaId: gitex }).ref!;
    ask(gitex, "Draft the Gitex PRD.", req1, chat1);
    recordFirstMateReply(
      store,
      block({
        do: "document",
        request: req1,
        title: "Gitex PRD",
        type: "prd",
        body: "# PRD v1",
      }),
    );

    const v1Doc = snap().library.find((item) => item.title === "Gitex PRD")!;
    const v1Origin = v1Doc.origin!;
    expect(v1Doc.version).toBe(1);
    expect(v1Origin.chatId).toBe(chat1);
    expect(v1Origin.requestRef).toBe(req1);

    // Owner approves v1.
    expect(
      send("approve-output", {
        outputId: v1Doc.id,
        approved: true,
        versionNumber: 1,
      }).ok,
    ).toBe(true);

    // Second request in a different chat revises the same output via outputId + expectedVersion: 1.
    const chat2 = send("new-chat", { workAreaId: gitex }).ref!;
    ask(gitex, "Update the Gitex PRD with security section.", req2, chat2);
    recordFirstMateReply(
      store,
      block({
        do: "document",
        request: req2,
        outputId: v1Doc.id,
        expectedVersion: 1,
        title: "Gitex PRD",
        type: "prd",
        body: "# PRD v2\n\n## Security",
      }),
    );

    const v2Doc = snap().library.find((item) => item.id === v1Doc.id)!;
    expect(v2Doc.version).toBe(2);
    expect(v2Doc.body).toBe("# PRD v2\n\n## Security");
    // Approval stays pinned on v1.
    expect(v2Doc.approvedVersion).toBe(1);
    // Canonical origin stays pinned on v1 in chat1!
    expect(v2Doc.origin).toEqual(v1Origin);
    // Project link preserved.
    expect(v2Doc.workAreaIds).toEqual([gitex]);
    // Both versions kept in history.
    expect(v2Doc.versions.map((v) => v.version)).toEqual([2, 1]);

    // A new delivered card with version: 2 landed in chat2.
    const chat2Cards = snap()
      .chats.find((c) => c.id === chat2)!
      .messages.filter(
        (m) => (m.card as { kind?: string } | null)?.kind === "delivered",
      );
    expect(chat2Cards).toHaveLength(1);
    expect(chat2Cards[0]!.card).toEqual({
      kind: "delivered",
      outputId: v1Doc.id,
      title: "Gitex PRD",
      version: 2,
      request: req2,
    });
  });

  it("treats identical replay as a harmless no-op without creating a duplicate version or card", () => {
    const { gitex } = setupGroups();
    ask(gitex, "Draft spec.", req1, null);
    recordFirstMateReply(
      store,
      block({
        do: "document",
        request: req1,
        title: "Spec",
        type: "doc",
        body: "# v1",
      }),
    );
    const outputId = snap().library[0]!.id;

    ask(gitex, "Revise spec.", req2, null);
    const revisionReply = block({
      do: "document",
      request: req2,
      outputId,
      expectedVersion: 1,
      title: "Spec",
      type: "doc",
      body: "# v2",
    });
    recordFirstMateReply(store, revisionReply);
    expect(snap().library[0]!.version).toBe(2);
    expect(deliveries()).toHaveLength(2);

    // Exact replay (even though expectedVersion is 1 and target is now v2) is a no-op.
    recordFirstMateReply(store, revisionReply);
    expect(snap().library[0]!.version).toBe(2);
    expect(deliveries()).toHaveLength(2);
    expect(
      allMessages().filter(
        (m) =>
          (m.card as { kind?: string } | null)?.kind === "document-refused",
      ),
    ).toHaveLength(0);
  });

  it("refuses stale expectedVersion cleanly without overwriting the newer version", () => {
    const { gitex } = setupGroups();
    ask(gitex, "Draft spec.", req1, null);
    recordFirstMateReply(
      store,
      block({
        do: "document",
        request: req1,
        title: "Spec",
        type: "doc",
        body: "# v1",
      }),
    );
    const outputId = snap().library[0]!.id;

    ask(gitex, "Revise spec to v2.", req2, null);
    recordFirstMateReply(
      store,
      block({
        do: "document",
        request: req2,
        outputId,
        expectedVersion: 1,
        title: "Spec",
        type: "doc",
        body: "# v2",
      }),
    );

    // Third request arrives with stale expectedVersion: 1 and different body.
    ask(gitex, "Stale edit.", req3, null);
    recordFirstMateReply(
      store,
      block({
        do: "document",
        request: req3,
        outputId,
        expectedVersion: 1,
        title: "Spec",
        type: "doc",
        body: "# stale overwrite attempt",
      }),
    );

    const doc = snap().library.find((item) => item.id === outputId)!;
    expect(doc.version).toBe(2);
    expect(doc.body).toBe("# v2");
    expect(deliveries()).toHaveLength(2);

    const refusal = allMessages().find(
      (m) => (m.card as { kind?: string } | null)?.kind === "document-refused",
    );
    expect(refusal).toBeDefined();
    expect(refusal?.card).toMatchObject({
      kind: "document-refused",
      outputId,
      reason: "stale_version",
      expectedVersion: 1,
      currentVersion: 2,
    });
  });

  it("refuses wrong-group, missing outputId, unknown request, and unprompted anonymous revisions", () => {
    const { gitex, home } = setupGroups();
    ask(gitex, "Draft work doc.", req1, null);
    recordFirstMateReply(
      store,
      block({
        do: "document",
        request: req1,
        title: "Work Doc",
        type: "doc",
        body: "# Work v1",
      }),
    );
    const workOutputId = snap().library[0]!.id;

    // 1. Wrong-group revision from Personal request -> refused, no overwrite, no replacement created.
    ask(home, "Try to overwrite work doc.", personalReq, null);
    recordFirstMateReply(
      store,
      block({
        do: "document",
        request: personalReq,
        outputId: workOutputId,
        expectedVersion: 1,
        title: "Work Doc",
        type: "doc",
        body: "# Hijacked",
      }),
    );
    expect(snap().library).toHaveLength(1);
    expect(snap().library[0]!.body).toBe("# Work v1");
    expect(snap().library[0]!.version).toBe(1);

    // 2. Missing outputId -> refused, no replacement created.
    ask(gitex, "Update missing doc.", req2, null);
    recordFirstMateReply(
      store,
      block({
        do: "document",
        request: req2,
        outputId: "non-existent-output-id",
        title: "Ghost Doc",
        type: "doc",
        body: "# Should not exist",
      }),
    );
    expect(snap().library).toHaveLength(1);

    // 3. Explicit unknown request ref -> refused even on prompted apply-reply (saveText: false).
    send("apply-reply", {
      text: block({
        do: "document",
        request: "amun-r-eeeeeeeeeeee",
        outputId: workOutputId,
        title: "Work Doc",
        type: "doc",
        body: "# Unknown ref attempt",
      }),
      workAreaId: gitex,
      chatId: null,
      saveText: false,
    });
    expect(snap().library[0]!.body).toBe("# Work v1");

    // 4. Unprompted reply (saveText: true) with no request ref -> refused.
    recordFirstMateReply(
      store,
      block({
        do: "document",
        outputId: workOutputId,
        title: "Work Doc",
        type: "doc",
        body: "# Anonymous unprompted attempt",
      }),
    );
    expect(snap().library[0]!.body).toBe("# Work v1");

    const refusals = allMessages().filter(
      (m) => (m.card as { kind?: string } | null)?.kind === "document-refused",
    );
    expect(refusals).toHaveLength(4);

    // 5. Prompted same-group turn without explicit request (saveText: false) IS allowed.
    send("apply-reply", {
      text: block({
        do: "document",
        outputId: workOutputId,
        expectedVersion: 1,
        title: "Work Doc",
        type: "doc",
        body: "# Prompted same-group v2",
      }),
      workAreaId: gitex,
      chatId: null,
      saveText: false,
    });
    expect(snap().library[0]!.version).toBe(2);
    expect(snap().library[0]!.body).toBe("# Prompted same-group v2");
  });

  it("preserves existing behavior when outputId is omitted: same title from a second request creates a separate output", () => {
    const { gitex } = setupGroups();
    ask(gitex, "First summary.", req1, null);
    ask(gitex, "Second summary.", req2, null);

    recordFirstMateReply(
      store,
      block({
        do: "document",
        request: req1,
        title: "Executive Summary",
        type: "doc",
        body: "# Summary A",
      }),
    );
    recordFirstMateReply(
      store,
      block({
        do: "document",
        request: req2,
        title: "Executive Summary",
        type: "doc",
        body: "# Summary B",
      }),
    );

    const summaries = snap().library.filter(
      (item) => item.title === "Executive Summary",
    );
    expect(summaries).toHaveLength(2);
    expect(summaries.map((item) => item.body).sort()).toEqual([
      "# Summary A",
      "# Summary B",
    ]);
    expect(summaries.every((item) => item.version === 1)).toBe(true);
  });
});
