import { expect, it } from "vitest";
import { notionToolPolicy } from "../src/notion-tools.ts";
it("classifies exact reviewed names only, never trusting annotations or prefixes", () => {
  expect(notionToolPolicy("notion-fetch")).toBe("read");
  expect(notionToolPolicy("notion-get-self")).toBe("read");
  expect(notionToolPolicy("notion-create-pages")).toBe("approved-publish");
  for (const name of [
    "notion-list-delete-all",
    "notion-delete-pages",
    "notion-update-page",
    "notion-spawn-session",
    "unknown",
    "",
  ])
    expect(notionToolPolicy(name)).toBe("blocked");
});
