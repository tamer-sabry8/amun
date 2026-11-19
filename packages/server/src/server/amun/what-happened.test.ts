import { describe, expect, it } from "vitest";
import {
  placeTurns,
  searchSteps,
  turnsFromTimeline,
  type MessageLike,
  type TimelineRowLike,
} from "./what-happened.js";

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 19, 10, 41, seconds)).toISOString();
const shell = (
  seq: number,
  seconds: number,
  command: string,
  output = "ok",
  turnId = "turn-1",
): TimelineRowLike => ({
  seq,
  timestamp: at(seconds),
  turnId,
  item: {
    type: "tool_call",
    callId: `c${seq}`,
    name: "bash",
    status: "completed",
    error: null,
    detail: { type: "shell", command, output },
  },
});

const rows: TimelineRowLike[] = [
  {
    seq: 1,
    timestamp: at(0),
    turnId: "turn-1",
    item: {
      type: "user_message",
      text: "[Work area: Customer Insights Portal]\nDraft three pricing options for the enterprise tier.",
    },
  },
  { seq: 2, timestamp: at(1), turnId: "turn-1", item: { type: "reasoning", text: "thinking" } },
  shell(3, 2, "bin/fm-fleet-snapshot.sh --json"),
  shell(4, 4, "bin/fm-spawn.sh --secondmate pricing-options", "started pricing-options"),
  { seq: 5, timestamp: at(8), turnId: "turn-1", item: { type: "assistant_message", text: "Product Manager is on " } },
  { seq: 6, timestamp: at(8), turnId: "turn-1", item: { type: "assistant_message", text: "“Pricing options”." } },
  { seq: 7, timestamp: at(1500), turnId: "turn-2", item: { type: "user_message", text: "Heartbeat: check the crew." } },
  shell(8, 1501, "bin/fm-peek.sh pricing-options", "ok", "turn-2"),
  { seq: 9, timestamp: at(1503), turnId: "turn-2", item: { type: "assistant_message", text: "All quiet." } },
];

const messages: MessageLike[] = [
  {
    id: "m1",
    workAreaId: "portal",
    role: "you",
    text: "Draft three pricing options for the enterprise tier.",
    createdAt: at(0),
  },
  { id: "m2", workAreaId: "chat", role: "firstmate", text: "All quiet.", createdAt: at(1504) },
];

describe("What happened", () => {
  it("groups the timeline into turns with plain-worded steps", () => {
    const turns = turnsFromTimeline(rows);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.steps.map((step) => [step.words, step.script])).toEqual([
      ["read who is working", "fm-fleet-snapshot"],
      ["started a secondmate in its own worktree", "fm-spawn --secondmate"],
      ["answered: “Product Manager is on “Pricing options”.”", null],
    ]);
    expect(turns[0]!.steps[1]).toMatchObject({
      sent: "bin/fm-spawn.sh --secondmate pricing-options",
      cameBack: "started pricing-options",
      durationMs: 4000,
    });
    expect(turns[0]!.durationMs).toBe(8000);
  });

  it("places each turn in the conversation it belongs to", () => {
    const [asked, woke] = placeTurns(turnsFromTimeline(rows), messages);
    expect(asked).toMatchObject({
      trigger: "you",
      workAreaId: "portal",
      prompt: "Draft three pricing options for the enterprise tier.",
    });
    // A turn nobody asked for is placed by the reply Amun saved from it.
    expect(woke).toMatchObject({ trigger: "woke", workAreaId: "chat" });
  });

  it("leaves a turn unplaced when the same words were said much earlier", () => {
    const old = [{ ...messages[0]!, createdAt: "2026-11-18T08:00:00.000Z" }];
    expect(placeTurns(turnsFromTimeline(rows), old)[0]!.workAreaId).toBeNull();
  });

  it("finds steps by what was sent or what came back", () => {
    const turns = placeTurns(turnsFromTimeline(rows), messages);
    expect(searchSteps(turns, "pricing spawn")).toEqual([
      {
        turnId: "t1",
        stepId: "s4",
        workAreaId: "portal",
        words: "started a secondmate in its own worktree",
        script: "fm-spawn --secondmate",
        at: at(4),
      },
    ]);
    expect(searchSteps(turns, "nothing-like-this")).toEqual([]);
  });

  it("marks a failed step and keeps its error", () => {
    const [turn] = turnsFromTimeline([
      rows[0]!,
      {
        seq: 2,
        timestamp: at(2),
        item: {
          type: "tool_call",
          callId: "c",
          name: "bash",
          status: "failed",
          error: "exit 1",
          detail: { type: "shell", command: "bin/fm-send.sh x" },
        },
      },
    ]);
    expect(turn!.steps[0]).toMatchObject({ failed: true, cameBack: "exit 1", words: "sent a message to a crewmate" });
  });
});
