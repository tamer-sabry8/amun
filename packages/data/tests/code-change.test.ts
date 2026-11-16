import { expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { CodeChangeReview, hashDiff } from "../src/code-change.ts";

const payload = (diff: string) => ({
  repo: { owner: "o", name: "r", url: "https://github.com/o/r" },
  base: "main",
  branch: "amun/x-111111",
  message: "Fix",
  title: "Fix",
  files: [{ path: "a", status: "added" as const, additions: 1, deletions: 0 }],
  diffHash: hashDiff(diff),
  job: "j",
  workAreaId: "w",
});
function setup(diff = "+a\n") {
  const db = new Database(":memory:");
  migrate(db);
  db.prepare("INSERT INTO products(id,name,created_at) VALUES (?,?,?)").run(
    "p",
    "P",
    "now",
  );
  const review = new CodeChangeReview(db);
  const item = review.propose("p", payload(diff), "b".repeat(40), diff);
  return { db, review, item };
}

it("stores the full diff and binds approval to its hash", () => {
  const { review, item } = setup();
  const read = review.read(item.id);
  expect(read.diff).toBe("+a\n");
  expect(read.diffIntact).toBe(true);
  expect(() =>
    review.approve(item.id, "0".repeat(64), { diffHash: hashDiff("+a\n") }),
  ).toThrow();
  expect(() =>
    review.approve(item.id, read.binding, { diffHash: hashDiff("+b\n") }),
  ).toThrow();
  review.approve(item.id, read.binding, { diffHash: hashDiff("+a\n") });
  expect(review.state(item.id)).toBe("approved");
});

it("a declined change cannot be approved", () => {
  const { review, item } = setup();
  review.decline(item.id);
  expect(() =>
    review.approve(item.id, review.read(item.id).binding, {
      diffHash: hashDiff("+a\n"),
    }),
  ).toThrow();
});
