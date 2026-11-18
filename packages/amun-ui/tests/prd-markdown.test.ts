import { expect, it } from "vitest";
import { parsePrd, writePrd, remarkDocument } from "../src/prd-markdown.ts";
it("preserves the PRD Markdown corpus through its actual Tiptap schema", () => {
  const corpus =
    "# Objective\n\nSome **bold**, *italic*, ~~old~~ and `code` with [evidence](https://example.org).\n\n- one\n- two\n\n1. first\n2. second\n\n- [ ] pending\n- [x] done\n\n| A | B |\n| --- | --- |\n| x | y |";
  const parsed = parsePrd(corpus);
  expect(parsed.warnings).toEqual([]);
  expect(remarkDocument(writePrd(parsed.doc))).toBe(remarkDocument(corpus));
});
it("warns before visual conversion of HTML or unsupported source constructs", () => {
  expect(parsePrd("hello <kbd>world</kbd>").warnings.length).toBeGreaterThan(0);
  expect(parsePrd("![image](file:///foreign)").warnings.length).toBeGreaterThan(
    0,
  );
});
