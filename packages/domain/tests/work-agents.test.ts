import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { agentCatalog, agentProfile } from "../src/work/agents.ts";

describe("day-one agents", () => {
  it("offers the owner's twenty agents, each fully described", () => {
    expect(agentCatalog).toHaveLength(20);
    expect(new Set(agentCatalog.map((agent) => agent.name)).size).toBe(20);
    for (const agent of agentCatalog) {
      expect(agent.summary.length).toBeLessThanOrEqual(64);
      expect(agent.scope).not.toBe("");
      expect(agent.outputs).not.toBe("");
      expect(agent.frameworks.length).toBeGreaterThanOrEqual(4);
      for (const [name, link] of agent.frameworks) {
        expect(name).not.toBe("");
        expect(link).toMatch(/^https:\/\//);
      }
    }
  });
  it("gives every agent a bundled picture, mirrored where one is shared", () => {
    const seen = new Map<string, number>();
    for (const agent of agentCatalog) {
      expect(
        existsSync(
          join("apps/desktop/renderer/avatars", agent.avatar + ".webp"),
        ),
        agent.avatar,
      ).toBe(true);
      seen.set(agent.avatar, (seen.get(agent.avatar) ?? 0) + 1);
      // A second use of the same animal is always the mirrored one.
      if (seen.get(agent.avatar) === 2) expect(agent.mirrored).toBe(true);
      expect(seen.get(agent.avatar)).toBeLessThanOrEqual(2);
    }
  });
  it("finds an agent by name, however it is cased", () => {
    expect(agentProfile(" qa ")?.name).toBe("QA");
    expect(agentProfile("Pricing analyst")).toBeUndefined();
  });
});

describe("a message that names its own group", () => {
  const groups = [
    { id: "w", name: "Work" },
    { id: "p", name: "Personal" },
    { id: "s", name: "Side business" },
  ];
  it("is understood without asking", async () => {
    const { groupMentioned } = await import("../src/work/model.ts");
    expect(groupMentioned("Draft a pilot plan for work", groups)).toBe("w");
    expect(
      groupMentioned("in my Side  Business, price the bundle", groups),
    ).toBe("s");
    expect(groupMentioned("This is a personal group thing", groups)).toBe("p");
  });
  it("does not guess from a bare word or from two groups", async () => {
    const { groupMentioned } = await import("../src/work/model.ts");
    expect(groupMentioned("Work on the launch deck", groups)).toBeNull();
    expect(
      groupMentioned("Compare for work and for personal", groups),
    ).toBeNull();
    expect(groupMentioned("Plan the pilot", groups)).toBeNull();
  });
});

describe("naming new work from a sentence", () => {
  it("keeps the name and drops the description that follows it", async () => {
    const { nameFromRequest } = await import("../src/work/model.ts");
    expect(
      nameFromRequest(
        "Create a product called named t-product-1 test it is for work and it has a deadline in 3 weeks there is not client.",
      ),
    ).toBe("t-product-1 test");
    expect(nameFromRequest("Create a product called Agentic Platform")).toBe(
      "Agentic Platform",
    );
    expect(
      nameFromRequest("Start a project named Atlas, due by next Friday"),
    ).toBe("Atlas");
    expect(
      nameFromRequest('Create a product called "Notes, for work and play"'),
    ).toBe("Notes, for work and play");
    expect(
      nameFromRequest("Track an RFP called Riyadh Metro for the client"),
    ).toBe("Riyadh Metro");
  });
});
