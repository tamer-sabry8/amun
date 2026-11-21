import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../src/sqlite.ts";
import { migrate } from "../src/database.ts";
import { WorkspaceService } from "../src/workspace-service.ts";
import { BoardDiscovery } from "../src/ado-board-discovery.ts";
import { AdoWriteClient } from "../src/ado-governed-writes.ts";
import { runAdoOperation } from "../src/ado-operations.ts";
import { comparePrd } from "../src/prd-comparison.ts";
import { appendAzureCriteria } from "../src/ado-publication-fields.ts";

it("adds a reviewed criterion inside existing Azure HTML without changing the Notes section", () => {
  const before =
    "<p>Intro</p><h3>Acceptance criteria</h3><ul><li>Keep</li></ul><h3>Notes</h3><p>Retain</p>";
  const after = appendAzureCriteria(before, ["Keep", "Support A&B"], true);
  expect(after).toBe(before.replace("</ul>", "<li>Support A&amp;B</li></ul>"));
  expect(appendAzureCriteria(after, ["Support A&B"], true)).toBe(after);
});

it("compares Gitex, creates one reviewed backlog item, reads it back and records one originating chat receipt on duplicate confirmation", async () => {
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
  expect(dispatch).toHaveBeenCalledTimes(1);
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
