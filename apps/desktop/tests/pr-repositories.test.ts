import { expect, it } from "vitest";
import { githubRow, repositoryTarget } from "../src/pr-repositories.ts";
it("turns GitHub's list into rows with author, checks and the size of the change", () => {
  const node = {
    number: 7,
    title: "Add export",
    url: "https://github.com/o/r/pull/7",
    isDraft: false,
    author: { login: "ana" },
    additions: 20,
    deletions: 4,
    changedFiles: 3,
    commits: { nodes: [{ commit: { statusCheckRollup: { state: "ERROR" } } }] },
  };
  expect(githubRow(node)).toMatchObject({
    number: 7,
    author: "ana",
    checks: "failing",
    files: 3,
    additions: 20,
    deletions: 4,
  });
  expect(
    githubRow({ ...node, author: null, commits: { nodes: [] } }),
  ).toMatchObject({ checks: "none" });
});
it("binds repository paths to the configured host or Azure collection and refuses credentials and ambiguous paths", () => {
  expect(
    repositoryTarget("https://example.test/Collection/P/_git/R"),
  ).toMatchObject({
    provider: "Azure Repos",
    collection: "https://example.test/Collection/",
    project: "P",
    repo: "R",
  });
  expect(repositoryTarget("https://github.com/owner/r.git")).toMatchObject({
    provider: "GitHub",
    owner: "owner",
    repo: "r",
  });
  for (const url of [
    "https://key@example.test/a/b",
    "http://example.test/a/b",
    "https://example.test/a/%2f",
    "https://example.test/a/b?token=x",
  ])
    expect(() => repositoryTarget(url)).toThrow();
});
