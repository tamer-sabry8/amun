import { it, expect } from "vitest";
import { projectSource } from "../src/project-source.ts";
const connection = { kind: "ado", baseUrl: "https://example.test/Collection" };
it("binds a mapped product project to its saved Azure collection", () => {
  expect(
    projectSource("https://example.test/Collection/Library%20Beta/", [
      connection,
    ]),
  ).toMatchObject({
    collection: "https://example.test/Collection/",
    project: "Library Beta",
  });
});
it.each([
  "https://other.test/Collection/Sales",
  "https://example.test/CollectionBackup/Sales",
  "https://example.test/Collection/a%2Fb",
  "https://example.test/Collection/Sales?a=1",
  "https://user@example.test/Collection/Sales",
])("rejects unmapped or unsafe project target %s", (url) => {
  expect(() => projectSource(url, [connection])).toThrow();
});
