import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  citationContext,
  splitCitations,
  type Piece,
} from "../src/rebuild/citations.ts";
import { MarkdownMessage } from "../src/rebuild/markdown-doc.tsx";

const DOC = "11111111-2222-4333-8444-555555555555";
const SRC = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ctx = citationContext({
  items: [{ id: DOC, title: "Launch plan" }],
  sources: [
    { id: SRC, title: "MoCA-BRD.docx", kind: "document", reference: null },
    {
      id: "99999999-2222-4333-8444-555555555555",
      title: "POCs",
      kind: "ado",
      reference: "https://devops.example/Coll/POCs/",
    },
  ],
});
const cites = (pieces: Piece[]) =>
  pieces.flatMap((p) => (typeof p === "string" ? [] : [p.cite]));

describe("citations", () => {
  it("links a Library document by source id and keeps the brackets as text", () => {
    const pieces = splitCitations(
      `See (Launch plan, source id ${DOC}, section 3.3) now`,
      ctx,
    );
    expect(cites(pieces)).toEqual([{ kind: "output", id: DOC }]);
    expect(pieces[0]).toBe("See (");
    expect(pieces[2]).toBe(") now");
  });

  it("opens an uploaded BRD in the PRD pane and unknown ids stay text", () => {
    expect(
      cites(splitCitations(`(MoCA-BRD.docx, source id ${SRC})`, ctx)),
    ).toEqual([{ kind: "prd" }]);
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect(splitCitations(`(x, source id ${unknown})`, ctx)).toEqual([
      `(x, source id ${unknown})`,
    ]);
  });

  it("links [title] only when exactly one document has that title", () => {
    expect(cites(splitCitations("As in [launch PLAN].", ctx))).toHaveLength(1);
    expect(cites(splitCitations("As in [Other].", ctx))).toHaveLength(0);
  });

  it("links #id to the work item only when a board is connected", () => {
    expect(cites(splitCitations("Fixed in #123, not a#4 or &#5", ctx))).toEqual(
      [
        {
          kind: "web",
          url: "https://devops.example/Coll/POCs/_workitems/edit/123",
        },
      ],
    );
    const none = citationContext({ items: [], sources: [] });
    expect(cites(splitCitations("Fixed in #123", none))).toEqual([]);
  });

  it("links web addresses, trims punctuation, and never links other schemes", () => {
    const pieces = splitCitations(
      "Read https://notion.so/Page-1. javascript:alert(1)",
      ctx,
    );
    expect(cites(pieces)).toEqual([
      { kind: "web", url: "https://notion.so/Page-1" },
    ]);
    expect(pieces.at(-1)).toBe(". javascript:alert(1)");
  });

  it("renders clickable buttons only when a handler is given", () => {
    const text = `(Launch plan, source id ${DOC})`;
    const withLinks = renderToStaticMarkup(
      createElement(MarkdownMessage, {
        text,
        citations: { context: ctx, onOpen: () => undefined },
      }),
    );
    expect(withLinks).toContain('class="link"');
    expect(
      renderToStaticMarkup(createElement(MarkdownMessage, { text })),
    ).not.toContain("<button");
  });
});
