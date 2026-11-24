import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/sqlite.ts";
import { migrate } from "../src/database.ts";
import { WorkspaceService } from "../src/workspace-service.ts";

// A PRD the crew wrote for a matched request becomes the product's next PRD
// version, so the PRD review, approval and "Generate stories" can use it
// (stories, backlogs and sprints brief: a PRD on the Mac is a source version).

const ref = "amun-r-f8e2e9ff68e2";

function fixture() {
  const db = openDatabase(":memory:");
  migrate(db);
  db.exec(`INSERT INTO products(id,name,created_at) VALUES('p','Sales Prospects','now');
    INSERT INTO work_areas(id,type,name,product_id,created_at) VALUES('area','product','Sales Prospects','p','now');
    INSERT INTO work_areas(id,type,name,product_id,created_at) VALUES('proj','project','Invoiced',NULL,'now');
    INSERT INTO work_messages(id,role,work_area_id,chat_id,text,created_at) VALUES('m1','you','area',NULL,'Reverse-engineer the PRD','now');
    INSERT INTO work_messages(id,role,work_area_id,chat_id,text,created_at) VALUES('m2','you','proj',NULL,'Write a BRD','now');
    INSERT INTO work_requests(ref,message_id,project_area_id,status,updated_at) VALUES('${ref}','m1','area','working','now');
    INSERT INTO work_requests(ref,message_id,project_area_id,status,updated_at) VALUES('amun-r-4741bf1f252e','m2','proj','working','now');`);
  return { db, workspace: new WorkspaceService(db) };
}

function objectives(db: ReturnType<typeof fixture>["db"]) {
  return db
    .prepare("SELECT id,statement FROM objectives WHERE product_id='p'")
    .all() as { id: string; statement: string }[];
}

describe("a crew PRD for a matched request", () => {
  it("is also kept once as a product source, so stories can be drafted from it", () => {
    const { db, workspace } = fixture();
    workspace.registerCrewPrd(
      ref,
      "# Sales Prospects - PRD\n\nFind prospects.",
      "Sales Prospects - PRD",
    );
    workspace.registerCrewPrd(
      ref,
      "# Sales Prospects - PRD\n\nFind prospects.",
      "Sales Prospects - PRD",
    );
    expect(
      db
        .prepare(
          "SELECT s.kind,s.external_id AS ref,s.title,d.body FROM sources s JOIN source_documents d ON d.source_id=s.id WHERE s.product_id='p'",
        )
        .all(),
    ).toEqual([
      {
        kind: "md",
        ref,
        title: "Sales Prospects - PRD",
        body: "# Sales Prospects - PRD\n\nFind prospects.",
      },
    ]);
  });

  it("becomes PRD v1 of the request's product, under an objective named after it, unapproved", () => {
    const { db, workspace } = fixture();
    const saved = workspace.registerCrewPrd(
      ref,
      "# Sales Prospects - PRD\n\nFind prospects.\n",
    );
    expect(saved).toMatchObject({ productId: "p", version: 1 });
    expect(objectives(db)).toEqual([
      { id: saved!.objectiveId, statement: "Sales Prospects" },
    ]);
    const prd = db
      .prepare("SELECT version,markdown FROM prds WHERE product_id='p'")
      .get() as { version: number; markdown: string };
    expect(prd).toEqual({
      version: 1,
      markdown: "# Sales Prospects - PRD\n\nFind prospects.",
    });
    expect(db.prepare("SELECT count(*) AS n FROM approvals").get()).toEqual({
      n: 0,
    });
  });

  it("adds no version for the same text and a new version for a revision", () => {
    const { db, workspace } = fixture();
    workspace.registerCrewPrd(ref, "# PRD\n\nv1");
    expect(workspace.registerCrewPrd(ref, "# PRD\n\nv1\n")).toMatchObject({
      version: 1,
    });
    expect(workspace.registerCrewPrd(ref, "# PRD\n\nv2")).toMatchObject({
      version: 2,
    });
    expect(objectives(db)).toHaveLength(1);
    expect(
      db.prepare("SELECT version FROM prd_versions ORDER BY version").all(),
    ).toEqual([{ version: 1 }, { version: 2 }]);
  });

  it("adds to the product's existing PRD and leaves its approval on the older version", () => {
    const { db, workspace } = fixture();
    db.exec(`INSERT INTO objectives(id,product_id,statement,status) VALUES('o','p','Prospect finding','active');
      INSERT INTO prds(id,product_id,objective_id,version,markdown,created_at) VALUES('doc','p','o',2,'Old PRD','now');
      INSERT INTO prd_versions(id,product_id,objective_id,prd_id,version,markdown,created_at) VALUES('v2','p','o','doc',2,'Old PRD','now');
      INSERT INTO approvals(id,prd_version_id,decision,kind,payload_hash,approved_by,approved_at) VALUES('ok','v2','approved','prd','hash','pm','now');`);
    expect(workspace.registerCrewPrd(ref, "New PRD")).toEqual({
      productId: "p",
      objectiveId: "o",
      version: 3,
    });
    expect(objectives(db)).toEqual([
      { id: "o", statement: "Prospect finding" },
    ]);
    const approved = db
      .prepare(
        "SELECT v.version FROM approvals a JOIN prd_versions v ON v.id=a.prd_version_id",
      )
      .all();
    expect(approved).toEqual([{ version: 2 }]);
  });

  it("is not a PRD for a project or an unknown request", () => {
    const { db, workspace } = fixture();
    expect(
      workspace.registerCrewPrd("amun-r-4741bf1f252e", "# BRD"),
    ).toBeNull();
    expect(
      workspace.registerCrewPrd("amun-r-000000000000", "# PRD"),
    ).toBeNull();
    expect(workspace.registerCrewPrd(ref, "   ")).toBeNull();
    expect(db.prepare("SELECT count(*) AS n FROM prds").get()).toEqual({
      n: 0,
    });
  });

  it("supports async crew story drafting, idempotent replay, and approved-version checks", async () => {
    const { db, workspace } = fixture();
    const prdMarkdown =
      "# PRD\nREQ-1: Preserve audit correlation IDs across retries.";
    const created = workspace.registerCrewPrd(ref, prdMarkdown, "Checkout PRD");
    expect(created).not.toBeNull();
    const o = created!.objectiveId;
    workspace.handle({
      version: 1,
      kind: "workspace",
      action: "preferences",
      preferences: { ...workspace.snapshot().preferences, productId: "p" },
    });
    workspace.handle({
      version: 1,
      kind: "workspace",
      action: "approve-prd",
      productId: "p",
      objectiveId: o,
      expectedVersion: 1,
      markdown: prdMarkdown,
    });

    const reviewRef = "amun-r-abcdef012345";
    const storyCmd = {
      version: 1,
      kind: "product-authoring",
      productId: "p",
      objectiveId: o,
      expectedVersion: 1,
      action: "stories",
      model: "firstmate",
      difficulty: "standard",
    };
    const bound = workspace.bindStoryReview(
      storyCmd,
      reviewRef,
      { areaId: "area", chatId: null },
      "Draft stories",
    );
    expect(bound.parent).toBe(reviewRef);

    // Async delegation ack does not throw and leaves drafts empty
    const ackRes = await workspace.author(
      storyCmd,
      async () => "Dispatched to PRD crewmate.",
    );
    expect(ackRes).toMatchObject({ kind: "workspace-snapshot" });
    expect(workspace.hasStoryDrafts(o, 1)).toBe(false);

    // Switch selected product away before late crew delivery arrives
    db.exec(
      `INSERT INTO products(id,name,created_at) VALUES('p2','Other','now');`,
    );
    workspace.handle({
      version: 1,
      kind: "workspace",
      action: "preferences",
      preferences: { ...workspace.snapshot().preferences, productId: "p2" },
    });

    const stories = [
      {
        title: "Preserve audit correlation IDs",
        requirement: "REQ-1: Preserve audit correlation IDs across retries.",
        acceptance: ["Correlation ID persists across retry"],
        tasks: ["Add correlation test"],
      },
    ];
    // Wrong version rejected
    expect(
      workspace.registerCrewStoryDrafts(reviewRef, stories, o, 2),
    ).toBeNull();
    // Unknown ref rejected
    expect(
      workspace.registerCrewStoryDrafts("amun-r-999999999999", stories),
    ).toBeNull();

    // Valid late crew delivery populates editable story_drafts + marks request delivered
    const filed = workspace.registerCrewStoryDrafts(reviewRef, stories, o, 1);
    expect(filed).toEqual({
      productId: "p",
      objectiveId: o,
      version: 1,
      inserted: 2,
      alreadyPresent: false,
    });
    expect(workspace.hasStoryDrafts(o, 1)).toBe(true);
    expect(
      db.prepare("SELECT status FROM work_requests WHERE ref=?").get(reviewRef),
    ).toEqual({ status: "delivered" });

    // Exact replay is idempotent (no duplicate work_items)
    const countBefore = db
      .prepare("SELECT count(*) AS n FROM work_items")
      .get();
    const replay = workspace.registerCrewStoryDrafts(reviewRef, stories, o, 1);
    expect(replay?.alreadyPresent).toBe(true);
    expect(db.prepare("SELECT count(*) AS n FROM work_items").get()).toEqual(
      countBefore,
    );
  });

  it("delivers verified publication receipts durably, deduplicates, and handles partial-to-confirmed updates", async () => {
    const { workspace } = fixture();
    const sent: string[] = [];
    const input = {
      kind: "ado" as const,
      targetId: "batch-1",
      destination: "ado:TahalufCollection|POCs|POCs Team",
      requestRef: ref,
      items: [
        {
          id: "item-1",
          state: "succeeded",
          remoteId: 73,
          remoteRev: 1,
          url: null,
          note: null,
        },
      ],
    };

    // Unlinked legacy receipt without requestRef is skipped
    const skipped = await workspace.deliverPublicationReceipt(
      { ...input, requestRef: null },
      async (p) => {
        sent.push(p);
        return "ok";
      },
    );
    expect(skipped.state).toBe("skipped");
    expect(sent).toHaveLength(0);

    // Transient failure persists state="unknown" without throwing
    const unknown = await workspace.deliverPublicationReceipt(
      input,
      async () => {
        throw new Error("primary busy");
      },
    );
    expect(unknown.state).toBe("unknown");

    // Retry succeeds and persists state="accepted"
    const accepted = await workspace.deliverPublicationReceipt(
      input,
      async (p) => {
        sent.push(p);
        return "noted";
      },
    );
    expect(accepted).toMatchObject({ state: "accepted", deduplicated: false });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(ref);
    expect(sent[0]).toContain("73");

    // Exact duplicate is deduplicated (0 extra sends)
    const dup = await workspace.deliverPublicationReceipt(input, async (p) => {
      sent.push(p);
      return "noted";
    });
    expect(dup).toMatchObject({ state: "accepted", deduplicated: true });
    expect(sent).toHaveLength(1);

    // Changed outcome (e.g. second item confirmed) gets a new fingerprint and delivers again
    const updated = await workspace.deliverPublicationReceipt(
      {
        ...input,
        items: [
          ...input.items,
          {
            id: "item-2",
            state: "succeeded",
            remoteId: 74,
            remoteRev: 1,
            url: null,
            note: null,
          },
        ],
      },
      async (p) => {
        sent.push(p);
        return "noted";
      },
    );
    expect(updated).toMatchObject({ state: "accepted", deduplicated: false });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("74");
  });
});
