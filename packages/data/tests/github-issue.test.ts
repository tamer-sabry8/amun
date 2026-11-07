import { expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { GithubIssueReview } from "../src/github-issue.ts";
it("requires the exact pending review and never creates the same issue twice after ambiguous delivery", async () => {
  const db = new Database(":memory:");
  migrate(db);
  const send = vi.fn().mockRejectedValue(Error("response lost"));
  const review = new GithubIssueReview(db);
  const item = review.prepare();
  expect(send).not.toHaveBeenCalled();
  await expect(review.publish(item.id, "0".repeat(64), send)).rejects.toThrow();
  expect(await review.publish(item.id, item.binding, send)).toBe("unknown");
  expect(send).toHaveBeenCalledTimes(1);
  expect(() => new GithubIssueReview(db).prepare()).toThrow();
  await expect(review.publish(item.id, item.binding, send)).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
  db.close();
});
it("reopens the same exact review and persists the verified issue number after success", async () => {
  const db = new Database(":memory:");
  migrate(db);
  const review = new GithubIssueReview(db),
    item = review.prepare();
  expect(new GithubIssueReview(db).prepare()).toEqual(item);
  const send = vi.fn().mockResolvedValue(123);
  expect(await review.publish(item.id, item.binding, send)).toBe("succeeded");
  expect(send).toHaveBeenCalledWith({
    owner: item.owner,
    repo: item.repo,
    title: item.title,
    body: item.body,
  });
  expect(new GithubIssueReview(db).receipt(item.id)).toBe(123);
  await expect(review.publish(item.id, item.binding, send)).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
  db.close();
});
it("keeps an invalid remote issue number unconfirmed and supplies no receipt", async () => {
  const db = new Database(":memory:");
  migrate(db);
  const review = new GithubIssueReview(db),
    item = review.prepare();
  expect(await review.publish(item.id, item.binding, async () => 0)).toBe(
    "unknown",
  );
  expect(review.receipt(item.id)).toBeNull();
  db.close();
});
it("returns the completed acceptance issue after reopening the workspace", async () => {
  const db = new Database(":memory:");
  migrate(db);
  const review = new GithubIssueReview(db),
    item = review.prepare();
  expect(review.completedIssue()).toBeNull();
  await review.publish(item.id, item.binding, async () => 17);
  expect(new GithubIssueReview(db).completedIssue()).toBe(17);
  db.close();
});
