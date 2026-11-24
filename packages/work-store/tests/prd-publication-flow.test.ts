import { ProductAuthoring } from "../src/product-authoring.ts";
import { Redactor } from "../src/redaction.ts";
import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../src/sqlite.ts";
import { migrate } from "../src/database.ts";
import { WorkspaceService } from "../src/workspace-service.ts";
import { BoardDiscovery } from "../src/ado-board-discovery.ts";
import { AdoWriteClient } from "../src/ado-governed-writes.ts";
import { runAdoOperation } from "../src/ado-operations.ts";
import { compareEvidencePages, comparePrd } from "../src/prd-comparison.ts";
import { appendAzureCriteria } from "../src/ado-publication-fields.ts";

it("adds a reviewed criterion inside existing Azure HTML without changing the Notes section", () => {
  const before =
    "<p>Intro</p><h3>Acceptance criteria</h3><ul><li>Keep</li></ul><h3>Notes</h3><p>Retain</p>";
  const after = appendAzureCriteria(before, ["Keep", "Support A&B"], true);
  expect(after).toBe(before.replace("</ul>", "<li>Support A&amp;B</li></ul>"));
  expect(appendAzureCriteria(after, ["Support A&B"], true)).toBe(after);
});

it("compares Gitex, creates one reviewed backlog item, reads it back and records one originating chat receipt on duplicate confirmation", async () => {
  const db = createPrdFixture();
  const target = {
    collection: "https://controlled.invalid/C/",
    project: "Gitex",
    team: "team",
  };
  const reader = new BoardDiscovery(
    target.collection,
    target.project,
    async () => {
      throw Error("Unexpected endpoint");
    },
  );
  vi.spyOn(reader, "teams").mockResolvedValue([
    { id: "team", name: "Gitex team" },
  ]);
  vi.spyOn(reader, "levels").mockResolvedValue([
    { id: "stories", name: "Stories" },
  ]);
  vi.spyOn(reader, "cards").mockResolvedValue([]);
  vi.spyOn(reader, "boardSettings").mockResolvedValue({
    columnField: "WEF.State",
    canEdit: false,
  });
  vi.spyOn(reader, "processSchema").mockResolvedValue({
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
  });
  const common = {
    version: 1 as const,
    kind: "ado-operation" as const,
    productId: "p",
    sourceId: "t",
    team: "team",
    requestId: randomUUID(),
  };
  const origin = { areaId: "area", chatId: "chat" };
  await comparePrd(
    db,
    {
      ...common,
      action: "compare-prd",
      level: "stories",
      objectiveId: "o",
      versionNumber: 2,
      workAreaId: "area",
      chatId: "chat",
      space: "work",
      ref: "amun-r-ba0000000001",
    },
    reader,
    async () =>
      JSON.stringify({
        rows: [
          {
            draftId: "local",
            classification: "addition",
            providerId: null,
            revision: null,
            evidence: "",
            reason: "No backlog match.",
          },
        ],
      }),
    () => true,
  );
  const fields: Record<string, unknown> = {
    "System.TeamProject": "Gitex",
    "System.WorkItemType": "Story",
  };
  const transport = vi.fn(
    async (method: string, _url: string, body?: unknown) => {
      if (method === "POST") {
        for (const entry of body as { path: string; value: unknown }[])
          fields[entry.path.replace("/fields/", "")] = entry.value;
        return { status: 200, data: { id: 73, rev: 1 } };
      }
      return { status: 200, data: { id: 73, rev: 1, fields } };
    },
  );
  const client = new AdoWriteClient(
    target.collection,
    target.project,
    transport,
  );
  const workspace = new WorkspaceService(db);
  const dispatch = vi.fn(async () => "ACCEPT amun-r-ba0000000002");
  const preview = await runAdoOperation(
    db,
    {
      ...common,
      action: "preview",
      intent: "publish",
      level: "stories",
      area: "Gitex",
      iteration: "Gitex",
      assignee: "",
      items: [
        { id: "local", type: "Story", title: "Badge printing", fields: {} },
      ],
    },
    target,
    reader,
    client,
    () => true,
  );
  expect(transport).not.toHaveBeenCalled();
  if (!("batchId" in preview && preview.batchId && preview.binding))
    throw Error("missing preview");
  const approve = {
    ...common,
    action: "approve-execute" as const,
    origin,
    ref: "amun-r-ba0000000002",
    space: "work",
    batchId: preview.batchId,
    binding: preview.binding,
  };
  const submit = () =>
    runAdoOperation(db, approve, target, reader, client, () => true, {
      workspace,
      dispatch,
    });
  const original = db
    .prepare("SELECT body FROM work_items WHERE id='local'")
    .pluck()
    .get();
  db.prepare("UPDATE work_items SET body=? WHERE id='local'").run(
    "Changed wording",
  );
  await expect(submit()).rejects.toThrow("draft changed");
  expect(dispatch).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
  db.prepare("UPDATE work_items SET body=? WHERE id='local'").run(original);
  const result = await submit();
  await submit();
  expect(result).toMatchObject({
    receipts: [{ remoteId: 73, remoteRev: 1, state: "succeeded" }],
  });
  expect(fields["System.IterationPath"]).toBe("Gitex");
  expect(fields["System.Description"]).toContain("Print one badge");
  expect(dispatch).toHaveBeenCalledTimes(2);
  const receiptCall = (dispatch.mock.calls[1] as unknown[] | undefined)?.[1];
  expect(String(receiptCall)).toContain("[Amun verified publication outcome");
  expect(String(receiptCall)).toContain("73");
  expect(transport.mock.calls.map(([method]) => method)).toEqual([
    "POST",
    "GET",
  ]);
  expect(
    db
      .prepare(
        "SELECT count(*) AS n FROM work_messages WHERE role='card' AND chat_id='chat'",
      )
      .get(),
  ).toEqual({ n: 1 });
  db.close();
});

it("finds a duplicate on a later comparison page and holds an interrupted read", async () => {
  const draft = {
    id: "local",
    title: "Badge",
    requirement: "Badge",
    acceptance: "Print",
  };
  const records = [1, 2, 3].map((id) => ({
    id,
    rev: 2,
    title: id === 3 ? "Badge" : "Other",
    description: "x".repeat(110),
  }));
  const answer = vi.fn(async (prompt: string) => {
    const { backlogRecords } = JSON.parse(prompt.split("\n").at(-1)!) as {
      backlogRecords: { id: number; title: string }[];
    };
    const hit = backlogRecords.find((r) => r.id === 3);
    return JSON.stringify({
      rows: [
        {
          draftId: "local",
          classification: hit ? "covered" : "addition",
          providerId: hit?.id ?? null,
          revision: hit ? 2 : null,
          evidence: hit?.title ?? "",
          reason: hit ? "Title in this record" : "No match on this page",
        },
      ],
    });
  });
  const rows = await compareEvidencePages(
    {},
    "ref",
    [draft],
    records,
    answer,
    200,
  );
  expect(answer).toHaveBeenCalledTimes(3);
  expect(rows).toMatchObject([{ classification: "covered", providerId: 3 }]);
  let n = 0;
  await expect(
    compareEvidencePages(
      {},
      "ref",
      [draft],
      records,
      async (prompt) => {
        if (++n === 2) throw Error("read interrupted");
        return answer(prompt);
      },
      200,
    ),
  ).rejects.toThrow("read interrupted");
});

function createPrdFixture() {
  const db = openDatabase(":memory:");
  migrate(db);
  db.exec(`INSERT INTO products(id,name,created_at) VALUES('p','Gitex','now');
    INSERT INTO work_areas(id,type,name,product_id,created_at) VALUES('area','product','Gitex','p','now');
    INSERT INTO work_chats(id,work_area_id,title,kind,forked_from,created_at) VALUES('chat','area','PRD review','chat','','now');
    INSERT INTO objectives(id,product_id,statement,status) VALUES('o','p','Badge printing','active');
    INSERT INTO prds(id,product_id,objective_id,version,markdown,created_at) VALUES('doc','p','o',2,'Enable badge printing','now');
    INSERT INTO prd_versions(id,product_id,objective_id,prd_id,version,markdown,created_at) VALUES('v','p','o','doc',2,'Enable badge printing','now');
    INSERT INTO approvals(id,prd_version_id,decision,kind,payload_hash,approved_by,approved_at) VALUES('ok','v','approved','prd','hash','pm','now');
    INSERT INTO work_items(id,product_id,title,type,status,body,acceptance_json) VALUES('local','p','Badge printing','Story','draft','Enable badge printing','["Print one badge"]');
    INSERT INTO story_drafts VALUES('local','o',2,'R1','Enable badge printing');`);
  return db;
}

it("turns a verified coverage gap into a local editable criterion and refuses a stale correction", async () => {
  const db = createPrdFixture();
  db.prepare("UPDATE products SET allowed_models_json=? WHERE id='p'").run(
    JSON.stringify(["test"]),
  );
  db.prepare(
    "INSERT INTO sources(id,product_id,kind,title,retrieved_at,hash) VALUES('azure','p','ado','Azure','now','hash')",
  ).run();
  const row = {
    draftId: "local",
    classification: "covered",
    providerId: 24,
    revision: 3,
    evidence: "Print one badge",
    reason: "Print covered",
  };
  const result = {
    ref: "amun-r-112233445566",
    sourceId: "azure",
    team: "T",
    level: "stories",
    objectiveId: "o",
    version: 2,
    verifiedAt: "2026-11-21",
    rows: [row],
  };
  db.prepare("INSERT INTO prd_comparisons VALUES(?,?,?,?,?,?,?)").run(
    "p",
    "o",
    2,
    "azure",
    "T",
    "stories",
    JSON.stringify(result),
  );
  const cmd = {
    version: 1,
    kind: "product-authoring",
    action: "flag-coverage-gap",
    productId: "p",
    objectiveId: "o",
    expectedVersion: 2,
    model: "test",
    itemId: "local",
    baseline: { title: "Badge printing", acceptance: ["Print one badge"] },
    sourceId: "azure",
    team: "T",
    level: "stories",
    comparisonRef: result.ref,
    providerId: 24,
    note: "Cover a lost badge.",
  };
  const fm = vi.fn(async () =>
      JSON.stringify({ criterion: "Reprint a lost badge." }),
    ),
    author = new ProductAuthoring(db, () => "p", new Redactor());
  await author.run(cmd, fm);
  expect(
    JSON.parse(
      String(
        db
          .prepare("SELECT acceptance_json FROM work_items WHERE id='local'")
          .pluck()
          .get(),
      ),
    ),
  ).toEqual(["Print one badge", "Reprint a lost badge."]);
  expect(
    JSON.parse(
      String(
        db.prepare("SELECT result_json FROM prd_comparisons").pluck().get(),
      ),
    ).rows[0],
  ).toMatchObject({ classification: "edit", providerId: 24, revision: 3 });
  await expect(author.run(cmd, fm)).rejects.toThrow("changed");
  expect(fm).toHaveBeenCalledTimes(1);
  db.close();
});
