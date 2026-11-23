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
