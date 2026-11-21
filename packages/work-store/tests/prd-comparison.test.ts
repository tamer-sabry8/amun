import { it, expect } from "vitest";
import { verifiedCoverage } from "../src/prd-comparison.ts";
const drafts = [
  {
    id: "badge",
    title: "Badge",
    acceptance: "[]",
    requirement: "Support a badge",
  },
];
const cards = [
  { id: 24, rev: 3, title: "Badges", description: "<p>Print a badge</p>" },
];
const base = {
  draftId: "badge",
  classification: "edit",
  providerId: 24,
  revision: 3,
  evidence: "Print a badge",
  reason: "The existing item covers printing.",
};
it("requires one result per proposal with an exact permitted provider revision and quotation", () => {
  const answer = (row: unknown) => JSON.stringify({ rows: [row] });
  expect(verifiedCoverage(answer(base), drafts, cards)).toEqual([base]);
  expect(() =>
    verifiedCoverage(
      answer({ ...base, evidence: "Scan a badge" }),
      drafts,
      cards,
    ),
  ).toThrow("unverified");
  expect(() =>
    verifiedCoverage(answer({ ...base, revision: 2 }), drafts, cards),
  ).toThrow("unverified");
  expect(() =>
    verifiedCoverage(JSON.stringify({ rows: [] }), drafts, cards),
  ).toThrow("incomplete");
  expect(() =>
    verifiedCoverage(
      answer({ ...base, classification: "addition" }),
      drafts,
      cards,
    ),
  ).toThrow("Unmatched");
});
