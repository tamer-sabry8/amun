import { it, expect } from "vitest";
import { nativeDocumentPage } from "../src/native-pi-docs.ts";
it("pages the pinned document without silent truncation and refuses invalid page selectors", () => {
  expect(nativeDocumentPage("a".repeat(60000) + "second", "1")).toMatchObject({
    kind: "document",
    page: 1,
    totalPages: 2,
    text: "second",
  });
  for (const value of ["-1", "1.5", "/personal", "2"])
    expect(() => nativeDocumentPage("hello", value)).toThrow();
  expect(() => nativeDocumentPage("a".repeat(2097153), "")).toThrow();
});
