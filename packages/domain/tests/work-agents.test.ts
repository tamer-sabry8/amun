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
