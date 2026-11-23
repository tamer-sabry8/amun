import { describe, expect, it } from "vitest";
import { openWorkStore } from "../src/index.ts";

function opened() {
  const work = openWorkStore(":memory:");
  const send = (action: string, extra: object = {}) =>
    work.store
      .handle({ version: 1, kind: "work", action, ...extra })
      .find((event) => (event as { kind?: string }).kind === "work-result") as {
      ok: boolean;
      ref: string | null;
      message: string;
    };
  send("add-group", { name: "Work" });
  const group = work.store.snapshot().groups[0]!.id;
  return { work, send, group };
}

describe("a project in delivery mode (Idea to Done §3.2)", () => {
  it("gets a delivery record once, and its checklist tasks become stories", () => {
    const { work, send, group } = opened();
    const gitex = send("create-area", {
      groupId: group,
      type: "project",
      name: "Gitex Demo",
    }).ref!;
    expect(
      work.store.snapshot().areas.find((area) => area.id === gitex)?.productId,
    ).toBeNull();
    const saved = send("save-output", {
      groupId: group,
      type: "project_checklist",
      title: "Gitex Demo checklist",
      body: "# Project checklist\n\n- [ ] Demo script · Tamer · 5 Dec\n- [x] Book the stand",
      workAreaIds: [gitex],
    });
    expect(saved.ok).toBe(true);

    const first = send("start-delivery", { workAreaId: gitex });
    expect(first.ok).toBe(true);
    const again = send("start-delivery", { workAreaId: gitex });
    expect(again.ref).toBe(first.ref);
    expect(
      work.store.snapshot().areas.find((area) => area.id === gitex)?.productId,
    ).toBe(first.ref);

    const items = work.db
      .prepare(
        "SELECT title,status,body FROM work_items WHERE product_id=? ORDER BY title",
      )
      .all(first.ref) as { title: string; status: string; body: string }[];
    expect(items).toEqual([
      { title: "Book the stand", status: "Done", body: "" },
      {
        title: "Demo script",
        status: "To do",
        body: "Owner: Tamer\nDue: 5 Dec",
      },
    ]);
    work.close();
  });

  it("refuses an Initiative", () => {
    const { work, send, group } = opened();
    const task = send("create-area", {
      groupId: group,
      type: "task",
      name: "Ask legal",
    }).ref!;
    expect(send("start-delivery", { workAreaId: task })).toMatchObject({
      ok: false,
      message: "Only a product or a project can run with stories and sprints.",
    });
    work.close();
  });

  it("changes status only for stories kept in Amun", () => {
    const { work, send, group } = opened();
    const area = send("create-area", {
      groupId: group,
      type: "project",
      name: "Invoiced",
    }).ref!;
    const product = send("start-delivery", { workAreaId: area }).ref!;
    work.db
      .prepare(
        "INSERT INTO work_items(id,product_id,type,title,status) VALUES ('s1',?,'story','Add a customer','To do')",
      )
      .run(product);
    work.db
      .prepare(
        "INSERT INTO work_items(id,product_id,type,title,status,remote_system,remote_id) VALUES ('s2',?,'story','Send invoice','To do','linear','TRA-2')",
      )
      .run(product);
    expect(send("set-story-status", { itemId: "s1", status: "done" }).ok).toBe(
      true,
    );
    expect(send("set-story-status", { itemId: "s2", status: "done" }).ok).toBe(
      false,
    );
    const status = (id: string) =>
      (
        work.db.prepare("SELECT status FROM work_items WHERE id=?").get(id) as {
          status: string;
        }
      ).status;
    expect(status("s1")).toBe("Done");
    expect(status("s2")).toBe("To do");
    work.close();
  });

  it("links a release to its stories, once, and unlinks", () => {
    const { work, send } = opened();
    const link = { kind: "release_story", fromId: "release-1", toId: "s1" };
    send("link-delivery", link);
    send("link-delivery", link);
    const count = () =>
      (
        work.db.prepare("SELECT count(*) AS n FROM delivery_links").get() as {
          n: number;
        }
      ).n;
    expect(count()).toBe(1);
    send("link-delivery", { ...link, linked: false });
    expect(count()).toBe(0);
    work.close();
  });
});

describe("release close-out and Delivered (Idea to Done §4.11–4.12)", () => {
  const live = JSON.stringify({
    artifact: "v1.0",
    approval: {
      approvedBy: "Tamer",
      approvedArtifact: "v1.0",
      approvedAt: "2026-12-18T10:00:00Z",
    },
    requestedState: "verified_live",
    observedLiveVersion: "v1.0",
    smokeCheck: {
      status: "passed",
      checkedVersion: "v1.0",
      summary: "ok",
      checkedAt: "2026-12-18T11:00:00Z",
    },
  });

  function delivery() {
    const { work, send, group } = opened();
    const area = send("create-area", {
      groupId: group,
      type: "project",
      name: "Invoiced",
    }).ref!;
    const product = send("start-delivery", { workAreaId: area }).ref!;
    const insert = work.db.prepare(
      "INSERT INTO work_items(id,product_id,type,title,status,parent_id,remote_system,remote_id) VALUES (?,?,?,?,?,?,?,?)",
    );
    insert.run(
      "e1",
      product,
      "epic",
      "Customers",
      "In progress",
      null,
      null,
      null,
    );
    insert.run(
      "s1",
      product,
      "story",
      "Add a customer",
      "In review",
      "e1",
      null,
      null,
    );
    insert.run("s2", product, "story", "Import", "Done", "e1", null, null);
    insert.run(
      "s3",
      product,
      "story",
      "Email",
      "In progress",
      "e1",
      "linear",
      "TRA-3",
    );
    work.db
      .prepare(
        "INSERT INTO objectives(id,product_id,statement,status) VALUES ('o1',?,'Bill clients','active')",
      )
      .run(product);
    work.db
      .prepare(
        "INSERT INTO prds(id,product_id,objective_id,version,created_at) VALUES ('p1',?,'o1',2,'2026-12-01')",
      )
      .run(product);
    return { work, send, group, area, product };
  }

  it("closes only Verified-live releases, and only stories kept in Amun", () => {
    const { work, send, group, area } = delivery();
    const release = send("save-output", {
      groupId: group,
      type: "release_tracker",
      title: "Release v1.0",
      body: JSON.stringify({ artifact: "v1.0", requestedState: "scheduled" }),
      workAreaIds: [area],
    }).ref!;
    for (const id of ["s1", "s2", "s3"])
      send("link-delivery", {
        kind: "release_story",
        fromId: release,
        toId: id,
      });
    expect(send("close-out-release", { releaseId: release })).toMatchObject({
      ok: false,
      message: "Close-out starts once the release is Verified live.",
    });
    send("save-output", {
      outputId: release,
      groupId: group,
      type: "release_tracker",
      title: "Release v1.0",
      body: live,
      workAreaIds: [area],
    });
    const result = work.store
      .handle({
        version: 1,
        kind: "work",
        action: "close-out-release",
        releaseId: release,
      })
      .find(
        (e) => (e as { kind?: string }).kind === "work-result",
      ) as unknown as {
      ok: boolean;
      step: { closed: number; inTool: { key: string | null }[] };
    };
    expect(result.ok).toBe(true);
    expect(result.step.closed).toBe(1);
    expect(result.step.inTool.map((s) => s.key)).toEqual(["TRA-3"]);
    work.close();
  });

  it("is Delivered only for the approved version, its epics done and a live release that ships them", () => {
    const { work, send, group, area } = delivery();
    expect(send("mark-delivered", { workAreaId: area })).toMatchObject({
      ok: false,
      message:
        "Not delivered yet: version 2 of the requirements is not approved.",
    });
    work.db
      .prepare(
        "INSERT INTO prd_versions(id,product_id,objective_id,prd_id,version,created_at) SELECT 'v2',product_id,objective_id,id,2,'2026-12-01' FROM prds WHERE id='p1'",
      )
      .run();
    work.db
      .prepare(
        "INSERT INTO approvals(id,prd_version_id,decision,kind,payload_hash,approved_by,approved_at) VALUES ('a1','v2','approved','prd','h','pm','2026-12-02')",
      )
      .run();
    // A live release that ships none of these stories is not evidence.
    send("save-output", {
      groupId: group,
      type: "release_tracker",
      title: "Release v1.0",
      body: live,
      workAreaIds: [area],
    });
    work.db.prepare("UPDATE work_items SET status='Done'").run();
    expect(send("mark-delivered", { workAreaId: area })).toMatchObject({
      ok: false,
      message:
        "Not delivered yet: a release that ships these stories must be Verified live first.",
    });
    const release = work.store
      .snapshot()
      .library.find((item) => item.type === "release_tracker")!.id;
    send("link-delivery", {
      kind: "release_story",
      fromId: release,
      toId: "s1",
    });
    work.db
      .prepare("UPDATE work_items SET status='In review' WHERE id='s2'")
      .run();
    expect(send("mark-delivered", { workAreaId: area })).toMatchObject({
      ok: false,
      message:
        "Not delivered yet: every epic must be Done or moved to a later version.",
    });
    work.db.prepare("UPDATE work_items SET status='Done'").run();
    expect(send("mark-delivered", { workAreaId: area }).ok).toBe(true);
    expect(
      work.db.prepare("SELECT delivered_version FROM prds WHERE id='p1'").get(),
    ).toEqual({ delivered_version: 2 });
    work.close();
  });

  it("treats a malformed release record as not live", () => {
    const { work, send, group, area } = delivery();
    const bad = send("save-output", {
      groupId: group,
      type: "release_tracker",
      title: "Release broken",
      body: JSON.stringify({ artifact: null, approval: {} }),
      workAreaIds: [area],
    }).ref!;
    send("link-delivery", { kind: "release_story", fromId: bad, toId: "s1" });
    expect(send("close-out-release", { releaseId: bad })).toMatchObject({
      ok: false,
      message: "Close-out starts once the release is Verified live.",
    });
    work.close();
  });
});
