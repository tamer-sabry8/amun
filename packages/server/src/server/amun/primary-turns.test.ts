import { describe, expect, it } from "vitest";
import type { ProductSpace } from "@getpaseo/protocol/amun-rpc";
import {
  describeTurnFailure,
  FirstMateTurnError,
  PrimarySessions,
  type PrimaryHost,
} from "./primary-session.js";

const space = {
  slug: "home",
  name: "Home",
  fmHome: "/home/firstmate",
  harness: "pi",
  backend: "tmux",
} as unknown as ProductSpace;

interface Turn {
  text: string;
  resolve(reply: string): void;
  reject(error: Error): void;
}

function host() {
  const turns: Turn[] = [];
  const cancelled: string[] = [];
  let open = false;
  const made: PrimaryHost = {
    createAgent: async () => ({ agentId: "fm" }),
    runAgent: (_agentId, text) => {
      // Paseo refuses a second turn while one is open.
      if (open) return Promise.reject(new Error("Agent fm already has an active run"));
      open = true;
      return new Promise((resolve, reject) => {
        turns.push({
          text,
          resolve: (reply) => {
            open = false;
            resolve({ finalText: reply });
          },
          reject,
        });
      });
    },
    cancelRun: async (agentId) => {
      cancelled.push(agentId);
      open = false;
    },
  };
  return { made, turns, cancelled };
}
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("messages to the First Mate", () => {
  it("answers them one at a time, in order, instead of refusing the second", async () => {
    const { made, turns } = host();
    const sessions = new PrimarySessions(made, "/root");
    const first = sessions.send(space, "one");
    const second = sessions.send(space, "two");
    await settled();
    expect(turns.map((turn) => turn.text)).toEqual(["one"]);
    expect(sessions.pending(space.fmHome)).toBe(2);

    turns[0].resolve("first reply");
    expect((await first).reply).toBe("first reply");
    await settled();
    expect(turns.map((turn) => turn.text)).toEqual(["one", "two"]);
    turns[1].resolve("second reply");
    expect((await second).reply).toBe("second reply");
    expect(sessions.pending(space.fmHome)).toBe(0);
  });

  it("closes a turn that failed, so the next message is not blocked by it", async () => {
    const { made, turns, cancelled } = host();
    const sessions = new PrimarySessions(made, "/root");
    const stuck = sessions.send(space, "/model");
    const next = sessions.send(space, "Help me connect to Notion");
    await settled();
    turns[0].reject(new Error("Pi RPC request timed out phase=prompt elapsedMs=60001"));
    await expect(stuck).rejects.toBeInstanceOf(FirstMateTurnError);
    await settled();
    expect(cancelled).toEqual(["fm"]);
    expect(turns.map((turn) => turn.text)).toEqual(["/model", "Help me connect to Notion"]);
    turns[1].resolve("Sure.");
    expect((await next).reply).toBe("Sure.");
  });

  it("says what happened in plain words, never an agent id", () => {
    const timeout = describeTurnFailure(new Error("Pi RPC request timed out phase=prompt"));
    const busy = describeTurnFailure(
      new Error("Agent 144770d7-c3e0-4629-b509-0ee88625a731 already has an active run"),
    );
    for (const failure of [timeout, busy]) {
      expect(failure.message).toMatch(/^Firstmate /);
      expect(failure.message).not.toMatch(/144770d7|Agent |RPC/);
    }
    expect(busy.detail).toContain("144770d7");
  });
});

describe("the First Mate after a daemon restart", () => {
  function records(initial: Record<string, string> = {}) {
    const kept = { ...initial };
    return {
      kept,
      store: {
        read: (home: string) => kept[home] ?? null,
        write: (home: string, id: string) => {
          kept[home] = id;
        },
      },
    };
  }
  function resumingHost(resumable: Set<string>) {
    const created: string[] = [];
    const host: PrimaryHost = {
      createAgent: async () => {
        const agentId = `fm-${created.length + 1}`;
        created.push(agentId);
        return { agentId };
      },
      runAgent: async () => ({ finalText: "" }),
      resumeAgent: async (agentId) => resumable.has(agentId),
    };
    return { host, created };
  }

  it("brings back the same First Mate instead of starting a second one", async () => {
    const { host, created } = resumingHost(new Set(["fm-earlier"]));
    const { store } = records({ [space.fmHome]: "fm-earlier" });
    const sessions = new PrimarySessions(host, "/root", () => null, store);
    expect(await sessions.start(space)).toEqual({ agentId: "fm-earlier" });
    expect(created).toEqual([]);
  });

  it("starts a new one, and remembers it, when the earlier one is gone", async () => {
    const { host, created } = resumingHost(new Set());
    const { kept, store } = records({ [space.fmHome]: "fm-archived" });
    const sessions = new PrimarySessions(host, "/root", () => null, store);
    expect(await sessions.start(space)).toEqual({ agentId: "fm-1" });
    expect(created).toEqual(["fm-1"]);
    expect(kept[space.fmHome]).toBe("fm-1");
  });

  it("remembers the first First Mate of a home", async () => {
    const { host } = resumingHost(new Set());
    const { kept, store } = records();
    const sessions = new PrimarySessions(host, "/root", () => null, store);
    await sessions.start(space);
    expect(kept).toEqual({ [space.fmHome]: "fm-1" });
  });

  it("starts a new one when bringing the earlier one back fails", async () => {
    const created: string[] = [];
    const host: PrimaryHost = {
      createAgent: async () => {
        created.push("fm-new");
        return { agentId: "fm-new" };
      },
      runAgent: async () => ({ finalText: "" }),
      resumeAgent: async () => {
        throw new Error("Agent is archived: fm-old");
      },
    };
    const { store } = records({ [space.fmHome]: "fm-old" });
    const sessions = new PrimarySessions(host, "/root", () => null, store);
    expect(await sessions.start(space)).toEqual({ agentId: "fm-new" });
  });
});
