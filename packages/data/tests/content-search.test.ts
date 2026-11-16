import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { WorkStore } from "../src/work-store.ts";
import { searchContent } from "../src/content-search.ts";

let db: Database.Database;
let store: WorkStore;
const at = "2026-11-15T10:00:00.000Z";
beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  store = new WorkStore(db);
  for (const [id, name, position] of [
    ["g1", "Work", 1],
    ["g2", "Personal", 2],
  ] as const)
    db.prepare("INSERT INTO work_groups VALUES (?,?,?,?)").run(
      id,
      name,
      position,
      at,
    );
  for (const [id, group] of [
    ["a1", "g1"],
    ["a2", "g2"],
  ] as const)
    db.prepare(
      "INSERT INTO work_areas(id,group_id,type,name,created_at) VALUES (?,?,'project',?,?)",
    ).run(id, group, "Area " + id, at);
});
const output = (
  id: string,
  group: string | null,
  title: string,
  body: string,
) =>
  db
    .prepare(
      "INSERT INTO library_outputs(id,group_id,type,title,body,created_at,updated_at) VALUES (?,?,'prd',?,?,?,?)",
    )
    .run(id, group, title, body, at, at);
const message = (id: string, area: string, text: string) =>
  db
    .prepare(
      "INSERT INTO work_messages(id,work_area_id,role,text,created_at) VALUES (?,?,'you',?,?)",
    )
    .run(id, area, text, at);

describe("content search", () => {
  it("finds words inside bodies with a marked snippet, stemmed", () => {
    output(
      "o1",
      "g1",
      "Pilot plan",
      "We agreed the pilot prices with finance.",
    );
    const [hit] = searchContent(db, "pricing", null);
    expect(hit).toMatchObject({
      kind: "document",
      id: "o1",
      title: "Pilot plan",
    });
    expect(hit!.snippet.filter((p) => p.match).map((p) => p.text)).toEqual([
      "prices",
    ]);
  });
  it("matches near-synonyms", () => {
    output("o1", "g1", "Notes", "The defect appears on login.");
    expect(searchContent(db, "bug", null)).toHaveLength(1);
  });
  it("ranks a title match above a body mention", () => {
    output("o1", "g1", "Budget", "other");
    output("o2", "g1", "Other", "a long text that mentions the budget once");
    expect(searchContent(db, "budget", null).map((h) => h.id)).toEqual([
      "o1",
      "o2",
    ]);
  });
  it("never reads another group's content when a group is active", () => {
    output("o1", "g1", "Mine", "secret roadmap");
    output("o2", "g2", "Theirs", "secret roadmap");
    message("m2", "a2", "secret roadmap talk");
    message("m1", "a1", "secret roadmap talk");
    const ids = (g: string | null) =>
      searchContent(db, "secret roadmap", g)
        .map((h) => h.id)
        .sort();
    expect(ids("g1")).toEqual(["m1", "o1"]);
    expect(ids("g2")).toEqual(["m2", "o2"]);
    expect(ids(null)).toHaveLength(4);
  });
  it("keeps the index current on edit, and drops deleted work's messages", () => {
    output("o1", "g1", "Doc", "alpha");
    db.prepare("UPDATE library_outputs SET body='omega' WHERE id='o1'").run();
    expect(searchContent(db, "alpha", null)).toEqual([]);
    expect(searchContent(db, "omega", null)).toHaveLength(1);
    message("m1", "a1", "omega chat");
    db.prepare("UPDATE work_areas SET status='deleted' WHERE id='a1'").run();
    expect(searchContent(db, "omega", null).map((h) => h.id)).toEqual(["o1"]);
  });
  it("indexes content that existed before the migration", () => {
    const old = new Database(":memory:");
    migrate(old, 37);
    old
      .prepare(
        "INSERT INTO library_outputs(id,group_id,type,title,body,created_at,updated_at) VALUES ('o',NULL,?,?,?,?,?)",
      )
      .run("x", "x", "legacy body", at, at);
    migrate(old);
    expect(searchContent(old, "legacy", null)).toHaveLength(1);
  });
  it("answers through the store for the active group only", () => {
    output("o1", "g1", "Mine", "zeta");
    output("o2", "g2", "Theirs", "zeta");
    store.handle({
      version: 1,
      kind: "work",
      action: "setup",
      patch: { activeGroupId: "g1" },
    });
    expect(store.search("zeta").map((h) => h.id)).toEqual(["o1"]);
  });
});
