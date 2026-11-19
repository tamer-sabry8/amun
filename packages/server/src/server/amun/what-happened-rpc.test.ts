import { describe, expect, it } from "vitest";
import { AmunRpcHandler, type AmunRpcDeps } from "./amun-rpc-handler.js";
import type { TimelineRowLike } from "./what-happened.js";

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 19, 10, 41, seconds)).toISOString();
const rows: TimelineRowLike[] = [
  { seq: 1, timestamp: at(0), item: { type: "user_message", text: "[Portal]\nDraft three pricing options." } as never },
  {
    seq: 2,
    timestamp: at(2),
    item: {
      type: "tool_call",
      name: "bash",
      status: "completed",
      detail: { type: "shell", command: "bin/fm-spawn.sh pricing --token sk-secret-1", output: "started" },
    } as never,
  },
  { seq: 3, timestamp: at(6), item: { type: "assistant_message", text: "On it." } as never },
];

function handlerWith(readTimeline: AmunRpcDeps["readTimeline"]) {
  const sent: string[] = [];
  const deps = {
    work: {
      snapshot: () => ({
        setup: { activeGroupId: "g1" },
        areas: [
          { id: "portal", groupId: "g1" },
          { id: "other", groupId: "g2" },
        ],
        messages: [
          { id: "m1", workAreaId: "portal", role: "you", text: "Draft three pricing options.", createdAt: at(0) },
        ],
      }),
      handle: () => [],
      search: () => [{ kind: "message", id: "m1" }],
    },
    primary: {
      send: async (_space: unknown, text: string) => {
        sent.push(text);
        return { agentId: "fm", reply: "" };
      },
    },
    redactor: { text: (value: string) => value.replace(/sk-secret-1/g, "[REDACTED]") },
    trace: { record: () => undefined },
    fmHome: "/home/fm",
    readTimeline,
  } as unknown as AmunRpcDeps;
  return { handler: new AmunRpcHandler(deps), sent };
}

describe("What happened over Amun RPC", () => {
  it("returns a conversation's turns with secrets removed, and sends the First Mate nothing", async () => {
    const { handler, sent } = handlerWith(async () => rows);
    const read = (await handler.handle({ id: "1", method: "happened.read", workAreaId: "portal" })) as {
      available: boolean;
      turns: { steps: { sent: string; words: string }[] }[];
    };
    expect(read.available).toBe(true);
    expect(read.turns).toHaveLength(1);
    expect(read.turns[0]!.steps[0]).toMatchObject({
      words: "started a crewmate in its own worktree",
      sent: "bin/fm-spawn.sh pricing --token [REDACTED]",
    });
    const elsewhere = (await handler.handle({ id: "2", method: "happened.read", workAreaId: "other" })) as {
      turns: unknown[];
    };
    expect(elsewhere.turns).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("searches conversations and Firstmate's steps together", async () => {
    const { handler } = handlerWith(async () => rows);
    const found = (await handler.handle({ id: "3", method: "work.search", query: "spawn" })) as {
      hits: unknown[];
      steps: { stepId: string; workAreaId: string }[];
    };
    expect(found.hits).toEqual([{ kind: "message", id: "m1" }]);
    expect(found.steps).toMatchObject([{ stepId: "s2", workAreaId: "portal" }]);
  });

  it("places a turn asked from a fork in its work", async () => {
    const { handler } = handlerWith(async () => [
      { seq: 1, timestamp: at(0), item: { type: "user_message", text: "[Fork]\nWhat if we had one support person?" } as never },
      { seq: 2, timestamp: at(3), item: { type: "assistant_message", text: "Then mornings only." } as never },
    ]);
    const deps = (handler as unknown as { deps: AmunRpcDeps }).deps;
    const base = deps.work.snapshot() as Record<string, unknown>;
    deps.work.snapshot = () => ({
      ...base,
      chats: [
        {
          messages: [
            {
              id: "f1",
              workAreaId: "portal",
              role: "you",
              text: "What if we had one support person?",
              createdAt: at(0),
            },
          ],
        },
      ],
    });
    const read = (await handler.handle({ id: "5", method: "happened.read", workAreaId: "portal" })) as {
      turns: { prompt: string }[];
    };
    expect(read.turns.map((turn) => turn.prompt)).toEqual(["What if we had one support person?"]);
  });

  it("says nothing is available when no First Mate timeline can be read", async () => {
    const { handler } = handlerWith(async () => {
      throw new Error("agent not loaded");
    });
    expect(await handler.handle({ id: "4", method: "happened.read", workAreaId: "portal" })).toEqual({
      available: false,
      turns: [],
    });
  });
});
