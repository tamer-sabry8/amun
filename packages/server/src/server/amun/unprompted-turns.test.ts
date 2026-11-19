import { describe, expect, it } from "vitest";
import type { ProductSpace } from "@getpaseo/protocol/amun-rpc";
import type { AgentManagerEvent } from "../agent/agent-manager.js";
import { PrimarySessions, type PrimaryHost } from "./primary-session.js";
import { UnpromptedTurns, type UnpromptedReply } from "./unprompted-turns.js";

const space = {
  slug: "home",
  name: "Home",
  fmHome: "/home/firstmate",
  harness: "pi",
  backend: "tmux",
} as unknown as ProductSpace;

function stream(agentId: string, event: Record<string, unknown>): AgentManagerEvent {
  return {
    type: "agent_stream",
    agentId,
    event: { provider: "pi", ...event },
  } as unknown as AgentManagerEvent;
}
const started = (agentId: string) => stream(agentId, { type: "turn_started" });
const said = (agentId: string, text: string) =>
  stream(agentId, { type: "timeline", item: { type: "assistant_message", text } });
const used = (agentId: string) =>
  stream(agentId, { type: "timeline", item: { type: "tool_call", name: "bash" } });
const completed = (agentId: string) => stream(agentId, { type: "turn_completed" });

/** A First Mate whose turns Amun starts by hand, with the watcher beside it. */
function rig() {
  let finish: (reply: string) => void = () => {};
  const host: PrimaryHost = {
    createAgent: async () => ({ agentId: "fm" }),
    runAgent: () =>
      new Promise((resolve) => {
        finish = (reply) => resolve({ finalText: reply });
      }),
  };
  const sessions = new PrimarySessions(host, "/root");
  const replies: UnpromptedReply[] = [];
  const watcher = new UnpromptedTurns({
    homeOf: (agentId) => sessions.homeOf(agentId),
    isAmunTurn: (agentId) => sessions.isAmunTurn(agentId),
    onReply: (reply) => replies.push(reply),
  });
  return { sessions, watcher, replies, finish: (reply: string) => finish(reply) };
}
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("First Mate turns Amun did not ask for", () => {
  it("hands on the reply to a heartbeat", async () => {
    const { sessions, watcher, replies } = rig();
    await sessions.start(space);
    watcher.handle(started("fm"));
    watcher.handle(said("fm", "Standup: two crew working, "));
    watcher.handle(said("fm", "one blocked."));
    watcher.handle(completed("fm"));
    expect(replies).toEqual([
      { fmHome: space.fmHome, agentId: "fm", text: "Standup: two crew working, one blocked." },
    ]);
  });

  it("keeps only the last thing said, not the words before a tool ran", async () => {
    const { sessions, watcher, replies } = rig();
    await sessions.start(space);
    watcher.handle(started("fm"));
    watcher.handle(said("fm", "Let me check the fleet."));
    watcher.handle(used("fm"));
    watcher.handle(said("fm", "All crew are on track."));
    watcher.handle(completed("fm"));
    expect(replies.map((reply) => reply.text)).toEqual(["All crew are on track."]);
  });

  it("leaves a reply to the captain's own message to primary.send", async () => {
    const { sessions, watcher, replies, finish } = rig();
    const sent = sessions.send(space, "How is the crew?");
    await settled();
    expect(sessions.isAmunTurn("fm")).toBe(true);
    watcher.handle(started("fm"));
    watcher.handle(said("fm", "All good."));
    watcher.handle(completed("fm"));
    finish("All good.");
    expect((await sent).reply).toBe("All good.");
    expect(sessions.isAmunTurn("fm")).toBe(false);
    expect(replies).toEqual([]);
  });

  it("ignores agents that are not the First Mate, and turns that failed", async () => {
    const { sessions, watcher, replies } = rig();
    await sessions.start(space);
    watcher.handle(started("crew-1"));
    watcher.handle(said("crew-1", "Not for the captain."));
    watcher.handle(completed("crew-1"));
    watcher.handle(started("fm"));
    watcher.handle(said("fm", "Half a thought"));
    watcher.handle(stream("fm", { type: "turn_failed", error: "boom" }));
    expect(replies).toEqual([]);
  });

  it("says nothing for a turn that ended without words", async () => {
    const { sessions, watcher, replies } = rig();
    await sessions.start(space);
    watcher.handle(started("fm"));
    watcher.handle(used("fm"));
    watcher.handle(completed("fm"));
    expect(replies).toEqual([]);
  });
});
