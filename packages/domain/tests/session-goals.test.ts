import { it, expect } from "vitest";
import {
  blockedSummary,
  evaluateTurn,
  validateGoal,
} from "../src/session-goals.ts";

const criteria = [
  { id: "tests", description: "The test suite passes", check: "pnpm test" },
  {
    id: "build",
    description: "The production build succeeds",
    check: "pnpm build",
  },
];
const now = new Date("2026-11-10T10:00:00Z");
const pass = { id: "tests", passed: true, output: "" };

it("validates criteria and guardrails", () => {
  expect(validateGoal(criteria, { maxTurns: 5 })).toEqual([]);
  expect(
    validateGoal([], { maxTurns: 0, budgetMicros: -1, deadlineAt: "soon" }),
  ).toEqual([
    "Add at least one criterion",
    "Set a turn limit of at least 1",
    "The budget ceiling must be zero or more",
    "The time limit must be a date and time",
  ]);
  expect(
    validateGoal([criteria[0]!, { ...criteria[0]!, check: " " }], {
      maxTurns: 1,
    }),
  ).toEqual([
    "Criterion ids must be unique",
    "Every criterion needs an id, a description and a check",
  ]);
});

it("feeds failing output back, treats a missing result as not passed, and stops when all pass", () => {
  const verdict = evaluateTurn(
    criteria,
    { maxTurns: 5 },
    { turns: 1, spentMicros: 0 },
    { results: [pass] },
    now,
  );
  expect(verdict).toMatchObject({
    state: "running",
    passed: ["tests"],
    failed: ["build"],
  });
  expect(verdict.feedback).toContain("1 of 2 criteria are not met yet");
  expect(verdict.feedback).toContain("Not met: The production build succeeds");
  expect(verdict.feedback).toContain("The check produced no result.");
  const long = evaluateTurn(
    criteria,
    { maxTurns: 5 },
    { turns: 1, spentMicros: 0 },
    {
      results: [
        pass,
        {
          id: "build",
          passed: false,
          output: "x".repeat(9000) + "TS2322 at end",
        },
      ],
    },
    now,
  );
  expect(long.feedback).toContain("TS2322 at end");
  expect(long.feedback!.length).toBeLessThan(4600);
  expect(
    evaluateTurn(
      criteria,
      { maxTurns: 1 },
      { turns: 1, spentMicros: 0 },
      { results: [pass, { id: "build", passed: true, output: "" }] },
      now,
    ),
  ).toEqual({
    state: "satisfied",
    reason: null,
    passed: ["tests", "build"],
    failed: [],
    feedback: null,
  });
});

it("blocks on each guardrail and on the agent's own report, and summarises for a person", () => {
  const fail = { results: [pass] };
  const reason = (guardrails: object, progress: object, turn: object = fail) =>
    evaluateTurn(
      criteria,
      { maxTurns: 9, ...guardrails },
      { turns: 1, spentMicros: 0, ...progress },
      turn as never,
      now,
    ).reason;
  expect(reason({ maxTurns: 3 }, { turns: 3 })).toBe("turn_limit");
  expect(reason({ budgetMicros: 100 }, { spentMicros: 100 })).toBe("budget");
  expect(reason({ deadlineAt: "2026-11-10T09:00:00Z" }, {})).toBe("deadline");
  expect(
    reason(
      {},
      {},
      {
        ...fail,
        agentBlocked: {
          reason: "needs_decision",
          question: "Which SSO provider?",
        },
      },
    ),
  ).toBe("needs_decision");
  const verdict = evaluateTurn(
    criteria,
    { maxTurns: 2 },
    { turns: 2, spentMicros: 0 },
    fail,
    now,
  );
  expect(
    blockedSummary(criteria, verdict, ["Fixed the import", "Reran the build"]),
  ).toBe(
    [
      "Blocked — needs input: Reached the turn limit",
      "",
      "Attempted:",
      "- Fixed the import",
      "- Reran the build",
      "",
      "Passed:",
      "- The test suite passes",
      "",
      "Still failing:",
      "- The production build succeeds",
      "",
      "Needed from you: Raise the limit, change the criteria, or stop here.",
    ].join("\n"),
  );
  expect(
    blockedSummary(
      criteria,
      { ...verdict, reason: "needs_decision", passed: [] },
      [],
      "Which SSO provider?",
    ),
  ).toContain("Needed from you: Which SSO provider?");
});
