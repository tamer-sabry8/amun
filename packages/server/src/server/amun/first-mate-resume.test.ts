import { describe, expect, it } from "vitest";
import type { AgentManager, ManagedAgent } from "../agent/agent-manager.js";
import { agentManagerHost } from "./attach-amun.js";
import type { PrimaryLaunch } from "./primary-session.js";

const launch: PrimaryLaunch = {
  provider: "pi",
  cwd: "/firstmate",
  env: {},
  title: "First Mate",
};

function manager() {
  const closed: string[] = [];
  const agentManager = {
    closeAgent: async (agentId: string) => {
      closed.push(agentId);
    },
    setAgentModel: async () => undefined,
  } as unknown as AgentManager;
  return { agentManager, closed };
}

describe("resuming the First Mate", () => {
  it("asks the loader to match this harness and checkout before anything opens", async () => {
    const { agentManager, closed } = manager();
    const asked: unknown[] = [];
    const host = agentManagerHost(agentManager, async (agentId, expected) => {
      asked.push({ agentId, ...expected });
      return null;
    });
    expect(await host.resumeAgent!("fm-old", launch)).toBe(false);
    expect(asked).toEqual([{ agentId: "fm-old", provider: "pi", cwd: "/firstmate" }]);
    expect(closed).toEqual([]);
  });

  it("closes an agent that still does not match once loaded, so no duplicate keeps running", async () => {
    const { agentManager, closed } = manager();
    const host = agentManagerHost(
      agentManager,
      async () => ({ id: "fm-old", provider: "claude", cwd: "/firstmate" }) as ManagedAgent,
    );
    expect(await host.resumeAgent!("fm-old", launch)).toBe(false);
    expect(closed).toEqual(["fm-old"]);
  });

  it("resumes the matching First Mate", async () => {
    const { agentManager, closed } = manager();
    const host = agentManagerHost(
      agentManager,
      async () => ({ id: "fm-old", provider: "pi", cwd: "/firstmate" }) as ManagedAgent,
    );
    expect(await host.resumeAgent!("fm-old", launch)).toBe(true);
    expect(closed).toEqual([]);
  });
});
