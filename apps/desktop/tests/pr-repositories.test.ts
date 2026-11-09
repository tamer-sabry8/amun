import { expect, it } from "vitest";
import { repositoryTarget } from "../src/pr-repositories.ts";
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
