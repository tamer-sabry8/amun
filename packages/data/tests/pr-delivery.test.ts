import { it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { DeliveryReview } from "../src/pr-delivery.ts";
it("refuses a changed head after a PM approval and requires a new review for the new head", async () => {
  const db = new Database(":memory:");
  migrate(db);
  db.prepare(
    "INSERT INTO products(id,name,created_at) VALUES('p','Pilot','now')",
  ).run();
  const d = new DeliveryReview(db),
    target = {
      product: "p",
      repo: "https://example.test/owner/pilot",
      number: 3,
      method: "squash" as const,
      base: "main",
    };
  let head = "a".repeat(40),
    merged = false;
  const read = async () => ({
    head,
    base: "main",
    merged,
    permitted: true,
    ready: true,
    methods: ["squash"],
  });
  const write = vi.fn(async (expected: string) => {
    expect(expected).toBe(head);
    merged = true;
  });
  const first = d.prepare(target, await read());
  d.approve(target, first.id, first.binding, await read());
  head = "b".repeat(40);
  await expect(
    d.execute(target, first.id, first.binding, read, write),
  ).rejects.toThrow(/changed/i);
  expect(write).not.toHaveBeenCalled();
  const second = d.prepare(target, await read());
  d.approve(target, second.id, second.binding, await read());
  await d.execute(target, second.id, second.binding, read, write);
  expect(write).toHaveBeenCalledTimes(1);
  expect(
    db.prepare("SELECT count(*) AS n FROM delivery_acceptance").get(),
  ).toEqual({ n: 0 });
  db.close();
});

it("binds the PM approval to the displayed repository, PR, method, base and fresh head", () => {
  const db = new Database(":memory:");
  migrate(db);
  db.prepare(
    "INSERT INTO products(id,name,created_at) VALUES('p','Pilot','now')",
  ).run();
  const d = new DeliveryReview(db),
    target = {
      product: "p",
      repo: "https://example.test/owner/pilot",
      number: 3,
      method: "squash" as const,
      base: "main",
    };
  const status = {
    base: "main",
    head: "a".repeat(40),
    merged: false,
    ready: true,
    permitted: true,
    methods: ["squash"],
  };
  const review = d.prepare(target, status);
  expect(() =>
    d.approve({ ...target, number: 4 }, review.id, review.binding, status),
  ).toThrow(/target/i);
  expect(() =>
    d.approve(target, review.id, review.binding, {
      ...status,
      head: "b".repeat(40),
    }),
  ).toThrow(/changed/i);
  expect(() =>
    d.approve(target, review.id, review.binding, { ...status, ready: false }),
  ).toThrow(/policy/i);
  d.approve(target, review.id, review.binding, status);
  db.close();
});

it("records one explicit acceptance per submission and only for a story with the verified delivery run", async () => {
  const db = new Database(":memory:");
  migrate(db);
  db.exec(
    "INSERT INTO products(id,name,created_at) VALUES('p','Pilot','now'); INSERT INTO work_items(id,product_id,type,title,status) VALUES('s','p','story','Deliver','published'),('other','p','story','Other','published')",
  );
  const d = new DeliveryReview(db),
    target = {
      product: "p",
      repo: "https://example.test/owner/pilot",
      number: 3,
      method: "squash" as const,
      base: "main",
    };
  const current = {
    base: "main",
    head: "a".repeat(40),
    merged: false,
    ready: true,
    permitted: true,
    methods: ["squash"],
  };
  const review = d.prepare(target, current);
  d.approve(target, review.id, review.binding, current);
  await d.execute(
    target,
    review.id,
    review.binding,
    async () => current,
    async () => {
      current.merged = true;
    },
  );
  db.prepare(
    "INSERT INTO runs(id,product_id,story_id,agent_role,harness,state,started_at) VALUES('run','p','s','engineer','codex','completed','now')",
  ).run();
  db.prepare(
    "INSERT INTO delivery_pull_requests(run_id,repo,number,head) VALUES('run',?,?,?)",
  ).run(target.repo, target.number, current.head);
  const record = (story: string, checks: string[]) =>
    d.accept(
      target,
      current,
      review.id,
      review.binding,
      story,
      "Accepted",
      "Mac test passed",
      checks,
    );
  const checks = [
    "Story status reviewed",
    "Merge verified",
    "Test evidence reviewed",
  ];
  expect(() => record("other", checks)).toThrow(/linked story/i);
  expect(() => record("s", ["unchecked"])).toThrow(/checklist/i);
  record("s", checks);
  record("s", checks);
  expect(
    db
      .prepare("SELECT story_id,verdict,rationale FROM delivery_acceptance")
      .all(),
  ).toEqual([
    { story_id: "s", verdict: "Accepted", rationale: "Mac test passed" },
  ]);
  db.close();
});
