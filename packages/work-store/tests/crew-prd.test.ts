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
});
