import { describe, expect, it } from "vitest";
import { outputCards } from "../src/rebuild/output-cards.tsx";

const doc = (id: string, title: string, extra: object = {}) => ({
  id,
  section: "output" as const,
  type: "doc",
  title,
  groupId: null,
  workAreaIds: ["a"],
  status: "Draft",
  needsLinking: false,
  body: "text",
  updatedAt: `2026-11-23T10:0${id}:00Z`,
  version: 1,
  approvedVersion: null,
  acceptance: null,
  ...extra,
});

describe("document cards in a chat (F1, F5)", () => {
  it("shows one card per document, hides an empty Untitled, folds finished ones", () => {
    const cards = outputCards([
      doc("1", "Release: v1.0", {
        type: "release_tracker",
        status: "Readiness",
      }),
      doc("2", "Release: v1.0", {
        type: "release_tracker",
        status: "Readiness",
      }),
      doc("3", "Release: v1.0", {
        type: "release_tracker",
        status: "Verified live",
      }),
      doc("4", "Untitled", { body: "" }),
      doc("5", "Brief", { status: "Done" }),
      doc("6", "Plan"),
    ] as never);
    expect(cards.open.map((c) => c.id)).toEqual(["6"]);
    expect(cards.done.map((c) => c.id)).toEqual(["5", "3"]);
  });
});
