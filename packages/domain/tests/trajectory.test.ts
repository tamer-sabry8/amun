import { it, expect } from "vitest";
import {
  compareReplay,
  eventContext,
  filterEvents,
  groupBySource,
  resumeBrief,
  summarizeBranch,
  type TrajectoryEvent,
} from "../src/trajectory.ts";

const event = (
  seq: number,
  changes: Partial<TrajectoryEvent> = {},
): TrajectoryEvent => ({
  id: "e" + seq,
  sessionId: "s",
  seq,
  at: `2026-11-10T10:0${seq}:00Z`,
  source: "user",
  kind: "request",
  participant: "pm",
  summary: "Event " + seq,
  detail: {},
  refersTo: null,
  status: null,
  tool: null,
  costMicros: null,
  durationMs: null,
  ...changes,
});
const events = [
  event(1, { summary: "Fix the overflow" }),
  event(2, { source: "context", kind: "inject", summary: "Loaded PRD v3" }),
  event(3, { source: "reasoning", kind: "plan", summary: "Check the CSS" }),
  event(4, {
    source: "tool",
    kind: "call",
    tool: "bash",
    participant: "engineer",
    summary: "Run lint",
    costMicros: 10,
    durationMs: 2000,
    detail: { command: "pnpm lint" },
  }),
  event(5, {
    source: "error",
    kind: "failure",
    participant: "engineer",
    summary: "Lint failed",
    refersTo: "e4",
    status: "failed",
  }),
];

it("filters on every word, on each facet and on a time window", () => {
  expect(filterEvents(events, {}).length).toBe(5);
  expect(filterEvents(events, { text: "LINT pnpm" }).map((e) => e.seq)).toEqual(
    [4],
  );
  expect(filterEvents(events, { text: "lint" }).map((e) => e.seq)).toEqual([
    4, 5,
  ]);
  expect(
    filterEvents(events, { sources: ["tool", "error"], statuses: ["failed"] }),
  ).toHaveLength(1);
  expect(filterEvents(events, { tools: ["git"] })).toEqual([]);
  expect(filterEvents(events, { kinds: ["plan"] })).toHaveLength(1);
  expect(
    filterEvents(events, {
      from: "2026-11-10T10:02:00Z",
      to: "2026-11-10T10:03:00Z",
    }).map((e) => e.seq),
  ).toEqual([2, 3]);
});

it("groups by source in a fixed order and gives an event its surroundings", () => {
  expect(groupBySource(events).map((g) => [g.source, g.events.length])).toEqual(
    [
      ["user", 1],
      ["reasoning", 1],
      ["tool", 1],
      ["context", 1],
      ["error", 1],
    ],
  );
  const context = eventContext(events, "e4", 1)!;
  expect(context.before.map((e) => e.seq)).toEqual([3]);
  expect(context.after.map((e) => e.seq)).toEqual([5]);
  expect(context.followUps.map((e) => e.seq)).toEqual([5]);
  expect(eventContext(events, "e5")!.refers?.seq).toBe(4);
  expect(eventContext(events, "nope")).toBeNull();
});

it("summarises a branch and reports an unanswered error as failed", () => {
  expect(resumeBrief(events).state).toBe("failed");
  expect(summarizeBranch("s", events)).toEqual({
    sessionId: "s",
    events: 5,
    toolCalls: 1,
    tools: ["bash"],
    errors: 1,
    costMicros: 10,
    durationMs: 2000,
    state: "failed",
    result: null,
  });
});

it("ignores reasoning and context when comparing a replay, and never calls a missing outcome reproduced", () => {
  const changed = events.map((e) =>
    e.seq === 3 ? { ...e, summary: "Thought differently" } : e,
  );
  const same = compareReplay("re_execution", events, changed);
  expect(same.differences).toEqual([]);
  expect(same.reproduced).toBe(false);
  const shorter = compareReplay("reconstruction", events, events.slice(0, 4));
  expect(shorter.differences).toEqual([
    {
      step: 3,
      original: "error | failure |  | Lint failed",
      replay: null,
    },
  ]);
  expect(
    compareReplay("re_execution", events, events, {
      original: { model: "a" },
      replay: { model: "a", tool: "2" },
    }).changedConditions,
  ).toEqual(["tool: not recorded → 2"]);
});
