import { expect, it, vi } from "vitest";
import { openDatabase } from "../src/sqlite.ts";
import { migrate } from "../src/database.ts";
import {
  applySprintMoves,
  inspectSprintSubmission,
} from "../src/sprint-submission.ts";
import type { SprintMoveRequest } from "../../contracts/src/backlog.ts";
import { AdoWriteClient } from "../src/ado-governed-writes.ts";

function fixture() {
  const db = openDatabase(":memory:");
  migrate(db);
  db.prepare(
    "INSERT INTO products(id,name,created_at) VALUES('p','Gitex','now')",
  ).run();
  db.prepare(
    "INSERT INTO work_areas(id,type,name,product_id,created_at) VALUES('gitex','product','Gitex','p','now')",
  ).run();
  db.prepare(
    "INSERT INTO work_chats(id,work_area_id,title,kind,forked_from,created_at,sprint_connection,sprint_id) VALUES('chat','gitex','Sprint 4','chat','','now','azure','ado:4')",
  ).run();
  const request: SprintMoveRequest = {
    version: 1,
    kind: "ado-operation",
    action: "apply-sprint-moves",
    requestId: crypto.randomUUID(),
    ref: "amun-r-123456789abc",
    space: "work",
    workAreaId: "gitex",
    chatId: "chat",
    productId: "p",
    sourceId: "azure",
    team: "T",
    level: "Stories",
    sprintId: "4",
    iteration: "Gitex/Sprint 4",
    moves: [24, 31].map((id) => ({
      id,
      rev: 3,
      title: "Story " + id,
      from: "Gitex",
      to: "Gitex/Sprint 4",
    })),
  };
  const target = {
    collection: "https://example.test/C/",
    project: "Gitex",
    team: "T",
  };
  const reader = {
    backlogIteration: async () => "Gitex",
    sprints: async () => [
      {
        id: "4",
        name: "Sprint 4",
        path: "Gitex/Sprint 4",
        start: "",
        finish: "",
      },
    ],
    levels: async () => [{ id: "Stories", name: "Stories" }],
    boardSettings: async () => ({
      columnField: "System.State",
      canEdit: false,
    }),
    cards: async () =>
      request.moves.map((m) => ({
        ...m,
        type: "Story",
        column: "To Do",
        state: "New",
        iteration: m.from,
        rev: m.id === 31 ? 4 : 3,
      })),
  };
  const transport = vi.fn(async (method: string) => {
    if (method === "PATCH") return { status: 200, data: { id: 24, rev: 4 } };
    return {
      status: 200,
      data: {
        id: 24,
        rev: 4,
        fields: {
          "System.TeamProject": "Gitex",
          "System.WorkItemType": "Story",
          "System.IterationPath": request.iteration,
        },
      },
    };
  });
  const client = new AdoWriteClient(
    target.collection,
    target.project,
    transport,
  );
  return { db, request, target, reader, client, transport };
}
it("binds one Firstmate prompt and receipt to the owning chat and independently verifies only the unchanged story", async () => {
  const { db, request, target, reader, client, transport } = fixture();
  const send = vi.fn(async () => "ACCEPT " + request.ref);
  const apply = () =>
    applySprintMoves(db, request, target, reader, client, () => true, send);
  const result = await apply();
  expect(result.receipts.map((row) => row.state)).toEqual([
    "confirmed",
    "held",
  ]);
  expect(await apply()).toEqual(result);
  expect(transport.mock.calls.map(([method]) => method)).toEqual([
    "PATCH",
    "GET",
  ]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(
    db.prepare("SELECT role,chat_id FROM work_messages ORDER BY rowid").all(),
  ).toEqual([
    { role: "you", chat_id: "chat" },
    { role: "card", chat_id: "chat" },
  ]);
  await expect(
    applySprintMoves(
      db,
      { ...request, moves: request.moves.slice(0, 1) },
      target,
      reader,
      client,
      () => true,
      send,
    ),
  ).rejects.toThrow("different changes");
  db.close();
});
it("holds all writes when Firstmate returns another request reference", async () => {
  const { db, request, target, reader, client, transport } = fixture();
  const result = await applySprintMoves(
    db,
    request,
    target,
    reader,
    client,
    () => true,
    async () => "ACCEPT amun-r-123456789000",
  );
  expect(result.receipts.map((row) => row.state)).toEqual(["held", "held"]);
  expect(transport).not.toHaveBeenCalled();
  db.close();
});

it("reconciles a denied read after a successful move without repeating the write", async () => {
  const { db, request, target, reader, transport } = fixture();
  let denyRead = true;
  const client = new AdoWriteClient(
    target.collection,
    target.project,
    async (method) =>
      method === "GET" && denyRead
        ? { status: 403, data: {} }
        : transport(method),
  );
  const result = await applySprintMoves(
    db,
    request,
    target,
    reader,
    client,
    () => true,
    async () => "ACCEPT " + request.ref,
  );
  expect(result.receipts[0]?.state).toBe("unknown");
  denyRead = false;
  const checked = await inspectSprintSubmission(db, request, target, client);
  expect(checked.receipts[0]?.state).toBe("confirmed");
  expect(transport.mock.calls.map(([method]) => method)).toEqual([
    "PATCH",
    "GET",
  ]);
  db.close();
});

it.each(["Gitex", "Another team's sprint"])(
  "limits returning a story to the verified team backlog path (%s)",
  async (to) => {
    const { db, request, target, reader } = fixture();
    request.moves = [{ ...request.moves[0]!, from: request.iteration, to }];
    const write = vi.fn(async () => ({ id: 24, rev: 4 }));
    const result = await applySprintMoves(
      db,
      request,
      target,
      reader,
      { write },
      () => true,
      async () => "ACCEPT " + request.ref,
    );
    if (to === "Gitex") {
      expect(write).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          fields: { "System.IterationPath": "Gitex" },
          revision: 3,
        }),
        null,
      );
      expect(result.receipts[0]?.state).toBe("confirmed");
    } else {
      expect(write).not.toHaveBeenCalled();
      expect(result.receipts[0]?.state).toBe("held");
    }
    db.close();
  },
);

it("carries only selected stories to the exact team iteration with one Firstmate request", async () => {
  const { db, request, target, reader } = fixture();
  const next = {
    id: "5",
    path: "Gitex/Sprint 5",
    name: "Sprint 5",
    start: "",
    finish: "",
  };
  const origin = await reader.sprints();
  reader.sprints = async () => [...origin, next];
  request.moves = [24, 32].map((id) => ({
    id,
    rev: 3,
    title: "Story " + id,
    from: request.iteration,
    to: next.path,
    targetSprintId: next.id,
  }));
  const cards = await reader.cards();
  reader.cards = async () => [...cards, { ...cards[0]!, id: 33 }];
  const write = vi.fn(async (step: { remoteId: number | null }) => ({
    id: step.remoteId!,
    rev: 4,
  }));
  const dispatch = vi.fn(async () => "ACCEPT " + request.ref);
  const result = await applySprintMoves(
    db,
    request,
    target,
    reader,
    { write },
    () => true,
    dispatch,
  );
  expect(result.receipts.map((r) => r.state)).toEqual([
    "confirmed",
    "confirmed",
  ]);
  expect(write.mock.calls.map(([s]) => s.remoteId)).toEqual([24, 32]);
  expect(dispatch).toHaveBeenCalledTimes(1);
  db.close();
});

it("sends a label-only change on the selected backlog record and preserves its other labels and sprint", async () => {
  const { db, request, target, reader } = fixture();
  request.moves = [
    { ...request.moves[0]!, to: "Gitex", addLabels: ["Release"] },
  ];
  const cards = await reader.cards();
  reader.cards = async () => cards.map((c) => ({ ...c, labels: ["Gitex"] }));
  let calls = 0;
  const client = new AdoWriteClient(
    target.collection,
    target.project,
    async (method, _url, body) => {
      calls++;
      if (method === "PATCH") {
        expect(body).toEqual([
          { op: "test", path: "/rev", value: 3 },
          { op: "add", path: "/fields/System.Tags", value: "Gitex; Release" },
        ]);
        return { status: 200, data: { id: 24, rev: 4 } };
      }
      return {
        status: 200,
        data: {
          id: 24,
          rev: 4,
          fields: {
            "System.WorkItemType": "Story",
            "System.TeamProject": "Gitex",
            "System.IterationPath": "Gitex",
            "System.Tags": "Release; Gitex",
          },
        },
      };
    },
  );
  const result = await applySprintMoves(
    db,
    request,
    target,
    reader,
    client,
    () => true,
    async () => "ACCEPT " + request.ref,
  );
  expect(result.receipts[0]?.state).toBe("confirmed");
  expect(calls).toBe(2);
  db.close();
});

it("verifies creation before attempting assignment and never repeats the create after a rejected move", async () => {
  const { db, request, target, reader } = fixture();
  const localId = crypto.randomUUID();
  request.moves = [];
  request.creates = [
    {
      localId,
      title: "Print pass",
      schedule: true,
      criteria: ["Print on arrival"],
      labels: ["Conference"],
    },
  ];
  request.creationTarget = {
    type: "Story",
    area: "Gitex",
    backlogIteration: "Gitex",
  };
  const send = vi.fn(async () => "ACCEPT " + request.ref);
  const fields: Record<string, unknown> = {
    "System.TeamProject": "Gitex",
    "System.WorkItemType": "Story",
  };
  const methods: string[] = [];
  const client = new AdoWriteClient(
    target.collection,
    target.project,
    async (method, _url, body) => {
      methods.push(method);
      if (method === "POST") {
        for (const patch of body as { path: string; value: unknown }[])
          fields[patch.path.replace("/fields/", "")] = patch.value;
      } else if (method === "PATCH") return { status: 403, data: {} };
      return { status: 200, data: { id: 75, rev: 1, fields } };
    },
  );
  const creationReader = {
    ...reader,
    planningCreationTarget: async () => request.creationTarget!,
    processSchema: async () => ({
      process: "Agile",
      areas: ["Gitex"],
      iterations: [],
      types: [
        {
          name: "Story",
          states: ["New"],
          fields: [
            {
              name: "Description",
              referenceName: "System.Description",
              required: false,
              allowedValues: [],
              defaultValue: null,
            },
          ],
        },
      ],
    }),
    cards: async () =>
      methods.length
        ? [
            {
              id: 75,
              rev: 1,
              title: "Print pass",
              state: "New",
              type: "Story",
              column: "New",
              iteration: "Gitex",
            },
          ]
        : [],
  };
  const apply = () =>
    applySprintMoves(
      db,
      request,
      target,
      creationReader,
      client,
      () => true,
      send,
    );
  const outcome = await apply();
  expect(outcome.receipts).toMatchObject([
    { itemId: localId, state: "held", remoteId: 75 },
  ]);
  expect(fields["System.IterationPath"]).toBe("Gitex");
  expect(fields["System.Tags"]).toContain("Conference");
  expect(await apply()).toEqual(outcome);
  expect(methods).toEqual(["POST", "GET", "PATCH"]);
  expect(send).toHaveBeenCalledTimes(1);
  db.close();
});

it("moves one record above its anchor in the complete shared order and reads that order back", async () => {
  const { db, request, target, reader } = fixture();
  const field = "Microsoft.VSTS.Common.StackRank" as const;
  const full = [1, 2, 3, 4].map((id) => ({
    id,
    title: [
      "Registration",
      "Badge printing",
      "Export attendance",
      "Offline check-in",
    ][id - 1]!,
    rev: 3,
    rank: { field, value: 10 * id },
    iteration: "Gitex",
    state: "New",
    type: "Story",
    column: "New",
  }));
  request.moves = [
    {
      id: 4,
      title: "Offline check-in",
      rev: 3,
      from: "Gitex",
      to: "Gitex",
      reorder: { beforeId: 2, anchorRev: 3, oldNext: null },
    },
  ];
  let cards = full;
  const read = vi.fn(async () => cards);
  const write = vi.fn(async (step: { fields: Record<string, unknown> }) => {
    expect(step.fields).toEqual({ [field]: 15 });
    cards = [full[0]!, full[3]!, full[1]!, full[2]!];
    return { id: 4, rev: 4 };
  });
  const result = await applySprintMoves(
    db,
    request,
    target,
    { ...reader, cards: read },
    { write },
    () => true,
    async () => "ACCEPT " + request.ref,
  );
  expect(result.receipts[0]?.state).toBe("confirmed");
  expect(write).toHaveBeenCalledTimes(1);
  expect(read.mock.calls.length).toBeGreaterThanOrEqual(3);
  db.close();
});
