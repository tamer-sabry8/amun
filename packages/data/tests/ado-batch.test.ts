import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { AdoBatch } from "../src/ado-batch.ts";
import { ActionStore } from "../src/outbox.ts";
it("recovers a lost response after item three, verifies markers and never publishes or commits an item twice", async () => {
  const db = new Database(":memory:");
  migrate(db);
  db.prepare(
    "INSERT INTO products(id,name,created_at) VALUES('p','Product','now')",
  ).run();
  const batch = new AdoBatch(db);
  const destination = {
    collection: "https://example.test/C/",
    project: "Library",
    team: "West",
  };
  const steps = Array.from({ length: 4 }, (_, i) => ({
    itemId: String(i),
    type: "Task",
    parentId: null,
    fields: { "System.Title": "Task " + i, "System.IterationPath": "Library" },
    marker: "Test-" + i,
    revision: 0,
    remoteId: null,
  }));
  const preview = batch.prepare("p", "publish", destination, steps);
  const remote = new Map<string, { id: number; rev: number }>();
  const writes: string[] = [];
  const adapter = {
    write: async (step: (typeof steps)[number]) => {
      writes.push(step.marker);
      const result = { id: writes.length, rev: 1 };
      remote.set(step.marker, result);
      if (writes.length === 3) throw Error("lost acknowledgement");
      return result;
    },
    find: async (step: (typeof steps)[number]) => remote.get(step.marker),
  };
  await expect(batch.execute(preview.id, "wrong", adapter)).rejects.toThrow();
  expect(writes).toEqual([]);
  await expect(
    batch.execute(preview.id, preview.binding, adapter),
  ).rejects.toThrow();
  batch.approve(preview.id, preview.binding);
  expect(
    (await batch.execute(preview.id, preview.binding, adapter)).map(
      (x) => x.state,
    ),
  ).toEqual(["succeeded", "succeeded", "unknown", "approved"]);
  new ActionStore(db).recover();
  expect(
    (await new AdoBatch(db).execute(preview.id, preview.binding, adapter)).map(
      (x) => x.remoteId,
    ),
  ).toEqual([1, 2, 3, 4]);
  await batch.execute(preview.id, preview.binding, adapter);
  expect(writes).toEqual(steps.map((s) => s.marker));
  expect(
    db.prepare("SELECT count(*) AS n FROM actions WHERE kind='commit'").get(),
  ).toEqual({ n: 0 });
  db.close();
});
it("refuses approval of overlapping publications even when both previews preceded the first approval", () => {
  const db = new Database(":memory:");
  migrate(db);
  db.prepare(
    "INSERT INTO products(id,name,created_at) VALUES('p','Product','now')",
  ).run();
  const b = new AdoBatch(db),
    d = {
      collection: "https://example.test/C/",
      project: "Library",
      team: "West",
    };
  const step = {
    itemId: "item",
    type: "Task",
    parentId: null,
    fields: { "System.Title": "Task" },
    revision: 0,
    remoteId: null,
    marker: "Test-first",
  };
  const a = b.prepare("p", "publish", d, [step]),
    other = b.prepare("p", "publish", d, [{ ...step, marker: "Test-second" }]);
  b.approve(a.id, a.binding);
  expect(() => b.approve(other.id, other.binding)).toThrow("already");
  db.close();
});
