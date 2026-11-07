import { it, expect } from "vitest";
import { sharingGate } from "../src/sharing-policy.ts";
it("disables Pi share regardless of configured providers and never falls back", () => {
  expect(
    sharingGate({
      destination: "pi",
      connected: true,
      parentSelected: true,
      parentId: "a".repeat(32),
      reviewedParentId: "a".repeat(32),
      contentHash: "a".repeat(64),
      reviewedHash: "a".repeat(64),
    }),
  ).toEqual({
    allowed: false,
    reason:
      "Pi sharing is disabled. Use Share to Notion; no gist or Radius fallback is allowed.",
  });
});
it("requires Notion connection, chosen parent and exact review before publishing", () => {
  for (const field of ["connected", "parentSelected"] as const) {
    const input = {
      destination: "notion" as const,
      connected: true,
      parentSelected: true,
      parentId: "a".repeat(32),
      reviewedParentId: "a".repeat(32),
      contentHash: "a".repeat(64),
      reviewedHash: "a".repeat(64),
    };
    input[field] = false;
    expect(sharingGate(input).allowed).toBe(false);
  }
  expect(
    sharingGate({
      destination: "notion",
      connected: true,
      parentSelected: true,
      parentId: "a".repeat(32),
      reviewedParentId: "a".repeat(32),
      contentHash: "a".repeat(64),
      reviewedHash: "a".repeat(64),
    }).allowed,
  ).toBe(true);
});

it("invalidates review when the exact content changes", () => {
  expect(
    sharingGate({
      destination: "notion",
      connected: true,
      parentSelected: true,
      parentId: "a".repeat(32),
      reviewedParentId: "a".repeat(32),
      contentHash: "a".repeat(64),
      reviewedHash: "b".repeat(64),
    }).allowed,
  ).toBe(false);
});
it("invalidates approval when the Notion destination changes", () => {
  expect(
    sharingGate({
      destination: "notion",
      connected: true,
      parentSelected: true,
      parentId: "a".repeat(32),
      reviewedParentId: "b".repeat(32),
      contentHash: "a".repeat(64),
      reviewedHash: "a".repeat(64),
    }).allowed,
  ).toBe(false);
});

it("rejects malformed parent identifiers, even if removing punctuation yields 32 hex digits", () => {
  expect(
    sharingGate({
      destination: "notion",
      connected: true,
      parentSelected: true,
      parentId: "-" + "a".repeat(32),
      reviewedParentId: "-" + "a".repeat(32),
      contentHash: "a".repeat(64),
      reviewedHash: "a".repeat(64),
    }).allowed,
  ).toBe(false);
});
