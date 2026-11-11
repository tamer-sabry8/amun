import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { SessionGoals } from "../src/session-goals.ts";

const setup = () => {
  const db = new Database(":memory:");
  migrate(db);
  let now = Date.parse("2026-11-10T10:00:00Z");
  return {
    db,
    goals: new SessionGoals(db, () => new Date(now)),
    advance: (ms: number) => (now += ms),
  };
};
const criteria = [
  { id: "tests", description: "The test suite passes", check: "pnpm test" },
  { id: "build", description: "The build succeeds", check: "pnpm build" },
];
const result = (tests: boolean, build: boolean) => [
  { id: "tests", passed: tests, output: tests ? "" : "2 failed" },
  { id: "build", passed: build, output: build ? "" : "TS2322" },
];

it("keeps the loop going with feedback until every criterion passes, then notifies once", () => {
  const { db, goals } = setup();
  const goal = goals.create({
    sessionRef: "s1",
    title: "Ship invites",
    criteria,
    guardrails: { maxTurns: 5 },
  });
  expect(goals.running().map((g) => g.id)).toEqual([goal.id]);
  const first = goals.recordTurn(goal.id, {
    results: result(false, false),
    attempted: "Wrote the form",
    costMicros: 10,
  });
  expect(first.goal).toMatchObject({
    state: "running",
    turns: 1,
    spentMicros: 10,
  });
  expect(first.feedback).toContain("2 of 2 criteria are not met yet");
  expect(first.feedback).toContain("TS2322");
  expect(goals.takeNotifications()).toEqual([]);
  expect(
    goals.recordTurn(goal.id, {
      results: result(true, false),
      attempted: "Fixed tests",
    }).feedback,
  ).toContain("1 of 2");
  const done = goals.recordTurn(goal.id, { results: result(true, true) });
  expect(done).toMatchObject({
    feedback: null,
    goal: { state: "satisfied", turns: 3 },
  });
  expect(goals.running()).toEqual([]);
  expect(goals.takeNotifications().map((n) => n.message)).toEqual([
    "Ship invites · Goal met after 3 turns: every criterion passes.",
  ]);
  expect(goals.takeNotifications()).toEqual([]);
  expect(() => goals.recordTurn(goal.id, { results: [] })).toThrow(
    /no longer running/,
  );
  expect(() => goals.cancel(goal.id)).toThrow(/already met/);
  db.close();
});

it("survives a restart: a new instance continues from the recorded turn", () => {
  const { db, goals } = setup();
  const goal = goals.create({
    sessionRef: "s1",
    title: "G",
    criteria,
    guardrails: { maxTurns: 3 },
  });
  goals.recordTurn(goal.id, {
    results: result(false, false),
    attempted: "First try",
  });
  const restarted = new SessionGoals(db);
  expect(restarted.running()[0]).toMatchObject({ id: goal.id, turns: 1 });
  expect(
    restarted.recordTurn(goal.id, { results: result(true, true) }).goal.state,
  ).toBe("satisfied");
  db.close();
});

it("blocks at each guardrail with a summary, and resumes only when the limit is raised", () => {
  const { db, goals, advance } = setup();
  const turns = goals.create({
    sessionRef: "s1",
    title: "Turns",
    criteria,
    guardrails: { maxTurns: 2 },
  });
  goals.recordTurn(turns.id, {
    results: result(true, false),
    attempted: "Try one",
  });
  const blocked = goals.recordTurn(turns.id, {
    results: result(true, false),
    attempted: "Try two",
  }).goal;
  expect(blocked).toMatchObject({
    state: "blocked",
    blockedReason: "turn_limit",
  });
  expect(blocked.last.summary).toContain(
    "Blocked — needs input: Reached the turn limit",
  );
  expect(blocked.last.summary).toContain("- Try one\n- Try two");
  expect(blocked.last.summary).toContain(
    "Still failing:\n- The build succeeds",
  );
  expect(goals.takeNotifications()).toHaveLength(1);
  expect(() => goals.resume(turns.id)).toThrow(/Raise the turn limit/);
  expect(goals.resume(turns.id, { maxTurns: 4 })).toMatchObject({
    state: "running",
    blockedReason: null,
    notifiedAt: null,
  });
  expect(
    goals.recordTurn(turns.id, { results: result(true, true) }).goal.state,
  ).toBe("satisfied");

  const budget = goals.create({
    sessionRef: "s2",
    title: "Budget",
    criteria,
    guardrails: { maxTurns: 9, budgetMicros: 100 },
  });
  expect(
    goals.recordTurn(budget.id, {
      results: result(false, true),
      costMicros: 150,
    }).goal.blockedReason,
  ).toBe("budget");
  expect(() => goals.resume(budget.id, { budgetMicros: 120 })).toThrow(
    /Raise the budget/,
  );
  expect(goals.resume(budget.id, { budgetMicros: 500 }).state).toBe("running");

  const timed = goals.create({
    sessionRef: "s3",
    title: "Timed",
    criteria,
    guardrails: { maxTurns: 9, deadlineAt: "2026-11-10T10:30:00Z" },
  });
  advance(3_600_000);
  expect(
    goals.recordTurn(timed.id, { results: result(false, true) }).goal
      .blockedReason,
  ).toBe("deadline");

  const asked = goals.create({
    sessionRef: "s4",
    title: "Asked",
    criteria,
    guardrails: { maxTurns: 9 },
  });
  const question = goals.recordTurn(asked.id, {
    results: result(true, false),
    agentBlocked: { reason: "needs_decision", question: "Which SSO provider?" },
  }).goal;
  expect(question.last.summary).toContain(
    "Needed from you: Which SSO provider?",
  );
  expect(goals.cancel(asked.id).state).toBe("cancelled");
  expect(() => goals.resume(asked.id)).toThrow(/Only a blocked goal/);
  expect(() =>
    goals.create({
      sessionRef: " ",
      title: " ",
      criteria: [],
      guardrails: { maxTurns: 0 },
    }),
  ).toThrow(/Add at least one criterion.*Name the goal.*Attach the goal/);
  db.close();
});
