import { describe, expect, it } from "vitest";
import {
  matchExpression,
  searchWords,
  snippetMarks,
  snippetParts,
  synonymsOf,
} from "../src/work/search.ts";

describe("content search query", () => {
  it("drops filler words and keeps the rest", () => {
    expect(searchWords("What is the pricing for the pilot?")).toEqual([
      "pricing",
      "pilot",
    ]);
  });
  it("adds near-synonyms, including for inflected words", () => {
    expect(synonymsOf("defects")).toContain("bug");
    expect(synonymsOf("zebra")).toEqual([]);
  });
  it("needs every word, lets the last one be a prefix, and can relax to any", () => {
    expect(matchExpression("launch dat")).toBe(
      '("launch" OR "release" OR "ship" OR "rollout") AND ("dat" OR "dat"*)',
    );
    expect(matchExpression("a b", "any")).toBeNull();
    expect(matchExpression("alpha beta", "any")).toContain(" OR ");
  });
  it("never lets typed punctuation into the expression", () => {
    expect(matchExpression('"; DROP* (x')).not.toMatch(/DROP\*|;/);
  });
  it("splits a snippet into plain parts", () => {
    const { open, close } = snippetMarks;
    expect(snippetParts(`…the ${open}price${close} list\n`)).toEqual([
      { text: "…the ", match: false },
      { text: "price", match: true },
      { text: " list ", match: false },
    ]);
  });
});
