import { describe, expect, it } from "vitest";
import { findFact, type Fact } from "../src/work/facts.ts";

const make = (id: string, key: string, value: string): Fact => ({
  id,
  groupId: null,
  key,
  value,
  source: "Email",
  observedAt: "2026-11-10",
  confirmed: true,
  synced: false,
});
const facts = [
  make("1", "reports-to", "Layla"),
  make("2", "office", "Dubai Marina"),
  make("3", "office-hours", "9 to 5"),
];

describe("findFact", () => {
  it("matches an exact key or value, then words inside the fact", () => {
    expect(findFact(facts, "reports-to")?.id).toBe("1");
    expect(findFact(facts, "dubai marina")?.id).toBe("2");
    expect(findFact(facts, "hours")?.id).toBe("3");
    expect(findFact(facts, "Layla is the manager")?.id).toBe("1");
  });
  it("returns null when none or several fit", () => {
    expect(findFact(facts, "")).toBeNull();
    expect(findFact(facts, "salary")).toBeNull();
    expect(findFact(facts, "office")?.id).toBe("2");
    expect(findFact(facts, "e")).toBeNull();
  });
});
