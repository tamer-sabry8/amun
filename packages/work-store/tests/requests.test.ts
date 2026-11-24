import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../src/sqlite.ts";
import { migrate } from "../src/database.ts";
import { WorkStore } from "../src/work-store.ts";
import { recordFirstMateReply } from "../src/first-mate-thread.ts";
import { readRequestBlocks } from "../../domain/src/work/requests.ts";

let db: Database;
let store: WorkStore;
let clock: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
  clock = Date.parse("2026-11-20T08:00:00Z");
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
function setup() {
  send("finish-setup", {
    workTypes: ["product", "project", "task", "rfp"],
    tools: [],
    agents: [],
    groups: [{ name: "Work", routes: [] }],
  });
  const group = snap().groups[0]!.id;
  const gitex = send("create-area", {
    groupId: group,
    type: "project",
    name: "Gitex",
  }).ref!;
  const amun = send("create-area", {
    groupId: group,
    type: "product",
    name: "Amun",
  }).ref!;
  const general = send("create-area", {
    groupId: group,
    type: "task",
    name: "Chat with Firstmate",
  }).ref!;
  return { group, gitex, amun, general };
}
const block = (value: object) => "```amun\n" + JSON.stringify(value) + "\n```";
const ask = (
  areaId: string,
  text: string,
  ref: string,
  chatId: string | null = null,
) => {
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
};
const allMessages = () => [
  ...snap().messages,
  ...snap().chats.flatMap((chat) => chat.messages),
];
const deliveries = () =>
  allMessages().filter(
    (message) =>
      (message.card as { kind?: string } | null)?.kind === "delivered",
  );

describe("request references", () => {
  const prd = "amun-r-aaaaaaaaaaaa";
  const email = "amun-r-bbbbbbbbbbbb";

  it("records a plain crew answer in its originating chat and preserves delivery against delayed progress", () => {
    const { gitex } = setup();
    const chatId = send("new-chat", { workAreaId: gitex }).ref!;
    ask(gitex, "Read the full PRD.", prd, chatId);
    send("message", {
      workAreaId: gitex,
      chatId,
      role: "firstmate",
      text: "PRD is reading.",
    });
    expect(
      send("record-firstmate-reply", {
        text:
          "PRD finished reading.\n" +
          block({
            do: "report",
            request: prd,
            status: "delivered",
            role: "PRD",
          }),
      }).ok,
    ).toBe(true);
    send("apply-reply", {
      text: block({
        do: "report",
        request: prd,
        status: "working",
        role: "PRD",
      }),
      workAreaId: gitex,
      chatId,
    });
    expect(snap().requests.find((request) => request.ref === prd)?.status).toBe(
      "delivered",
    );
    expect(
      snap()
        .chats.find((chat) => chat.id === chatId)
        ?.messages.map((message) => message.text),
    ).toEqual([
      "Read the full PRD.",
      "PRD is reading.",
      "PRD finished reading.",
    ]);
  });

  it("shows an early PRD completion only once when its ordinary wake arrives", () => {
    const { gitex } = setup();
    ask(gitex, "Read the PRD.", prd);
    const status = {
      do: "report",
      request: prd,
      status: "delivered",
      role: "PRD",
    };
    recordFirstMateReply(
      store,
      "PRD has finished.\n" + block(status),
      null,
      true,
    );
    recordFirstMateReply(
      store,
      "PRD sent its finished report.\n" + block(status),
    );
    expect(
      allMessages()
        .filter((message) => message.role === "firstmate")
        .map((message) => message.text),
    ).toEqual(["PRD has finished."]);
  });

  it("links two results that finish out of order to the exact message that asked", () => {
    const { gitex } = setup();
    const chat = send("new-chat", { workAreaId: gitex }).ref!;
    const first = ask(gitex, "Write the Gitex PRD.", prd, chat);
    const second = ask(gitex, "Draft the launch email.", email, chat);
    // The email finishes first, in a reply nobody asked for, filed from General.
    recordFirstMateReply(
      store,
      "The launch email is ready.\n" +
        block({
          do: "document",
          title: "Launch email",
          type: "doc",
          body: "Hello",
          request: email,
        }),
    );
    recordFirstMateReply(
      store,
      "The PRD is ready.\n" +
        block({
          do: "document",
          title: "Gitex PRD",
          type: "prd",
          body: "# PRD",
          request: prd,
        }) +
        block({
          do: "report",
          request: prd,
          status: "delivered",
          role: "Product Manager",
          text: "done",
        }),
    );
    const cards = deliveries().map(
      (message) => message.card as { request: string; title: string },
    );
    expect(cards).toEqual([
      expect.objectContaining({ title: "Launch email", request: email }),
      expect.objectContaining({ title: "Gitex PRD", request: prd }),
    ]);
    const chatMessages = snap().chats.find(
      (item) => item.id === chat,
    )!.messages;
    // Both results and Firstmate's words are in the chat that asked.
    expect(chatMessages.map((message) => message.text)).toEqual([
      "Write the Gitex PRD.",
      "Draft the launch email.",
      "The launch email is ready.",
      "Launch email",
      "The PRD is ready.",
      "Gitex PRD",
    ]);
    const requests = snap().requests;
    expect(requests.find((item) => item.ref === prd)).toMatchObject({
      messageId: first,
      status: "delivered",
      role: "Product Manager",
    });
    expect(requests.find((item) => item.ref === email)).toMatchObject({
      messageId: second,
      status: "sent",
    });
    // The project card gets the documents of its confirmed requests.
    const linked = snap().library.filter((item) =>
      item.workAreaIds.includes(gitex),
    );
    expect(linked.map((item) => item.title).sort()).toEqual([
      "Gitex PRD",
      "Launch email",
    ]);
  });

  it("keeps a result with an unknown or missing reference where it arrived", () => {
    const { gitex } = setup();
    ask(gitex, "Write the Gitex PRD.", prd);
    recordFirstMateReply(
      store,
      "Here is something.\n" +
        block({
          do: "report",
          request: "amun-r-cccccccccccc",
          status: "delivered",
          role: "PM",
          text: "x",
        }) +
        block({ do: "document", title: "Loose note", type: "doc", body: "x" }),
    );
    // Nothing was marked Ready or linked to Gitex.
    expect(snap().requests[0]).toMatchObject({ status: "sent" });
    expect(
      snap().library.filter((item) => item.workAreaIds.includes(gitex)),
    ).toEqual([]);
    const card = deliveries()[0]!;
    expect(card.card).toMatchObject({ request: null });
    expect(card.workAreaId).not.toBe(gitex);
  });

  it("shows a report it cannot match, and changes no request", () => {
    const { gitex } = setup();
    ask(gitex, "Write the Gitex PRD.", prd);
    recordFirstMateReply(
      store,
      block({
        do: "report",
        request: "amun-r-dddddddddddd",
        status: "working",
        role: "Researcher",
        text: "gathering evidence",
      }) + block({ do: "report", status: "failed", role: "QA", text: "" }),
    );
    expect(snap().requests[0]).toMatchObject({ status: "sent" });
    expect(allMessages().at(-1)).toMatchObject({
      role: "firstmate",
      text: "QA: work did not finish.\nResearcher: gathering evidence.",
    });
  });

  it("never links a document without a matching reference to the project it arrived in", () => {
    const { gitex } = setup();
    send("apply-reply", {
      text: block({ do: "document", title: "Notes", type: "doc", body: "x" }),
      workAreaId: gitex,
      chatId: null,
    });
    expect(deliveries()[0]).toMatchObject({ workAreaId: gitex });
    expect(snap().library[0]!.workAreaIds).toEqual([]);
  });

  it("keeps two requests' documents apart even with the same title", () => {
    const { gitex } = setup();
    ask(gitex, "Write a summary for the board.", prd);
    ask(gitex, "Write a summary for the team.", email);
    for (const ref of [prd, email])
      recordFirstMateReply(
        store,
        block({
          do: "document",
          title: "Summary",
          type: "doc",
          body: "Same",
          request: ref,
        }),
      );
    expect(
      deliveries().map(
        (message) => (message.card as { request: string }).request,
      ),
    ).toEqual([prd, email]);
    expect(
      snap().library.filter((item) => item.title === "Summary"),
    ).toHaveLength(2);
  });

  it("applies a repeated report and a repeated delivery once", () => {
    const { gitex } = setup();
    ask(gitex, "Write the Gitex PRD.", prd);
    const reply =
      block({
        do: "report",
        request: prd,
        status: "working",
        role: "Product Manager",
        text: "drafting the PRD",
      }) +
      block({
        do: "document",
        title: "Gitex PRD",
        type: "prd",
        body: "# v1",
        request: prd,
      });
    recordFirstMateReply(store, reply);
    const updated = snap().requests[0]!.updatedAt;
    recordFirstMateReply(store, reply);
    expect(deliveries()).toHaveLength(1);
    expect(snap().requests[0]!.updatedAt).toBe(updated);
    // A revision is a new version of the same document.
    recordFirstMateReply(
      store,
      block({
        do: "document",
        title: "Gitex PRD",
        type: "prd",
        body: "# v2",
        request: prd,
      }),
    );
    const documents = snap().library.filter(
      (item) => item.title === "Gitex PRD",
    );
    expect(documents).toHaveLength(1);
    expect(documents[0]!.version).toBe(2);
    expect(
      deliveries().map(
        (message) => (message.card as { version: number }).version,
      ),
    ).toEqual([1, 2]);
  });

  it("follows a chat that moved, and keeps the request's confirmed project", () => {
    const { gitex, amun } = setup();
    const chat = send("new-chat", { workAreaId: gitex }).ref!;
    ask(gitex, "Write the Gitex PRD.", prd, chat);
    // Amun's first chat is unused, so the moved chat becomes it.
    send("move-chat", {
      workAreaId: gitex,
      chatId: chat,
      toWorkAreaId: amun,
    });
    recordFirstMateReply(
      store,
      block({
        do: "document",
        title: "Gitex PRD",
        type: "prd",
        body: "# PRD",
        request: prd,
      }),
    );
    const there = snap().messages.filter((item) => item.workAreaId === amun);
    expect(there.at(-1)!.card).toMatchObject({
      kind: "delivered",
      request: prd,
    });
    // The deliverable belongs to the project that owned the work.
    expect(snap().library[0]!.workAreaIds).toEqual([gitex]);
  });

  it("records a requested change of project, and only Firstmate's answer settles it", () => {
    const { gitex, amun } = setup();
    ask(gitex, "Draft the launch email.", email);
    send("request-change", { ref: email, toAreaId: amun });
    expect(snap().requests[0]).toMatchObject({
      projectAreaId: gitex,
      changeToAreaId: amun,
      changeState: "requested",
    });
    send("request-change-result", { ref: email, accepted: true });
    expect(snap().requests[0]).toMatchObject({
      projectAreaId: amun,
      changeState: "",
    });
    expect(
      send("request-change-result", { ref: email, accepted: true }).ok,
    ).toBe(false);
    expect(
      send("request-report", {
        ref: "amun-r-000000000000",
        status: "working",
        fingerprint: "x",
      }).ok,
    ).toBe(false);
  });

  it("blocks cross-group request matches on prompted apply-reply while preserving General routing", () => {
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
    const workArea = send("create-area", {
      groupId: workGroup,
      type: "project",
      name: "Gitex",
    }).ref!;
    const personalArea = send("create-area", {
      groupId: personalGroup,
      type: "project",
      name: "Home Reno",
    }).ref!;
    const otherPersonal = send("create-area", {
      groupId: personalGroup,
      type: "project",
      name: "Garden",
    }).ref!;
    const personalRef = "amun-r-999999999999";
    ask(personalArea, "Plan the home renovation.", personalRef);
    send("request-change", { ref: personalRef, toAreaId: otherPersonal });

    // Prompted turn (saveText: false) in Work mentioning Personal's ref must NOT
    // update, move, raise a plan, or file a document into Personal.
    const res = send("apply-reply", {
      text:
        block({
          do: "report",
          request: personalRef,
          status: "delivered",
          role: "PM",
          text: "finished",
        }) +
        block({
          do: "reassigned",
          request: personalRef,
          project: "Garden",
          accepted: true,
        }) +
        block({
          do: "plan",
          request: personalRef,
          planKind: "stories",
          destination: "linear",
          summary: "Leak plan",
          items: [{ summary: "Task 1", fields: { type: "Story" } }],
        }) +
        block({
          do: "document",
          request: personalRef,
          title: "Leaked Doc",
          type: "doc",
          body: "Should not land in Personal",
        }),
      workAreaId: workArea,
      chatId: null,
      saveText: false,
      raisePlans: true,
    });
    expect(res.ok).toBe(true);
    // Personal request is untouched (neither delivered nor moved).
    expect(snap().requests.find((r) => r.ref === personalRef)).toMatchObject({
      status: "sent",
      projectAreaId: personalArea,
      changeState: "requested",
    });
    // No plan created in Personal or Work.
    expect(snap().plans).toHaveLength(0);
    // No document filed into Personal group or linked to personalArea.
    expect(
      snap().library.filter(
        (doc) =>
          doc.groupId === personalGroup ||
          doc.workAreaIds.includes(personalArea),
      ),
    ).toEqual([]);
    // Unprompted General reply (saveText: true) still routes valid refs across groups.
    recordFirstMateReply(
      store,
      "Personal update ready.\n" +
        block({
          do: "document",
          request: personalRef,
          title: "Renovation Plan",
          type: "doc",
          body: "# Reno",
        }),
    );
    expect(
      snap().library.find((doc) => doc.title === "Renovation Plan"),
    ).toMatchObject({
      groupId: personalGroup,
      workAreaIds: [personalArea],
    });
  });

  it("parses unescaped triple-backticks and unicode backticks inside document.body without leaking JSON", () => {
    const { gitex } = setup();
    ask(gitex, "Write an HTML integration guide.", prd);
    const bodyWithFences =
      'Use this snippet:\n\n```html\n<div class="card">Hello</div>\n```\n\nAnd JS:\n```js\nconsole.log(`ok`);\n```';
    const reply =
      "Here is the guide.\n\n" +
      block({
        do: "document",
        request: prd,
        title: "HTML Guide",
        type: "doc",
        body: bodyWithFences,
      }) +
      "\n\nLet me know if you want changes.";

    const parsed = readRequestBlocks(reply);
    expect(parsed.visible).toBe(
      "Here is the guide.\n\nLet me know if you want changes.",
    );
    expect(parsed.visible).not.toContain('"do":"document"');
    expect(parsed.documents).toHaveLength(1);
    expect(parsed.documents[0]).toMatchObject({
      request: prd,
      title: "HTML Guide",
      body: bodyWithFences,
    });

    // Also verify \u0060 escaped backticks continue to work.
    const unicodeReply =
      'Done.\n```amun\n{"do":"document","request":"' +
      prd +
      '","title":"Escaped","type":"doc","body":"\\u0060\\u0060\\u0060ts\\nconst x = 1;\\n\\u0060\\u0060\\u0060"}\n```';
    const parsedUnicode = readRequestBlocks(unicodeReply);
    expect(parsedUnicode.visible).toBe("Done.");
    expect(parsedUnicode.documents[0]?.body).toBe("```ts\nconst x = 1;\n```");

    // End-to-end through recordFirstMateReply stores the document intact.
    recordFirstMateReply(store, reply);
    expect(snap().library.find((doc) => doc.title === "HTML Guide")?.body).toBe(
      bodyWithFences,
    );
  });

  it("parses optional story-drafts amun blocks without breaking visible text", () => {
    const reply =
      "Drafted 2 stories.\n" +
      block({
        do: "story-drafts",
        request: prd,
        objectiveId: "obj-1",
        expectedVersion: 3,
        stories: [
          { title: "Add SSO login", points: 5 },
          { title: "Audit log export", points: 3 },
        ],
      });
    const parsed = readRequestBlocks(reply);
    expect(parsed.visible).toBe("Drafted 2 stories.");
    expect(parsed.storyDrafts).toEqual([
      {
        request: prd,
        objectiveId: "obj-1",
        expectedVersion: 3,
        stories: [
          { title: "Add SSO login", points: 5 },
          { title: "Audit log export", points: 3 },
        ],
      },
    ]);
  });

  it("refuses oversized (>100k) document bodies in apply-reply instead of persisting an un-editable document", () => {
    const { gitex } = setup();
    const chat = send("new-chat", { workAreaId: gitex }).ref!;
    ask(gitex, "Write a huge specification.", prd, chat);
    const oversized = "x".repeat(100_001);
    const res = send("apply-reply", {
      text: block({
        do: "document",
        request: prd,
        title: "Giant Spec",
        type: "prd",
        body: oversized,
      }),
      workAreaId: gitex,
      chatId: chat,
      saveText: false,
    });
    expect(res.ok).toBe(true);
    expect(snap().library).toHaveLength(0);
    expect(deliveries()).toHaveLength(0);
    const chatMessages = snap().chats.find((c) => c.id === chat)!.messages;
    const refusal = chatMessages.find(
      (m) => (m.card as { kind?: string } | null)?.kind === "document-refused",
    );
    expect(refusal).toBeDefined();
    expect(refusal?.text).toContain("Giant Spec");
    expect(refusal?.text).toContain("100,000");
  });

  it("trims oversized visible prose to 16,384 characters in apply-reply", () => {
    const { gitex } = setup();
    const res = send("apply-reply", {
      text: "z".repeat(20_000),
      workAreaId: gitex,
      chatId: null,
      saveText: true,
    });
    expect(res.ok).toBe(true);
    const saved = snap()
      .messages.filter((m) => m.workAreaId === gitex && m.role === "firstmate")
      .at(-1);
    expect(saved).toBeDefined();
    expect(saved!.text.length).toBe(16_384);
    expect(saved!.text.endsWith("…")).toBe(true);
  });
});
