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
