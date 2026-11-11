import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { OperationsData } from "../src/operations.ts";
import { Trajectory } from "../src/trajectory.ts";
import { TaskCheckout } from "../src/task-checkout.ts";
import { AgentOrg } from "../src/agent-org.ts";
import { Heartbeats } from "../src/heartbeats.ts";
import { SessionGoals } from "../src/session-goals.ts";

it("builds the dashboard's records from what Amun already stores", () => {
  const db = new Database(":memory:");
  migrate(db);
  let now = Date.parse("2026-11-10T10:00:00Z");
  const clock = () => new Date(now);
  const t = new Trajectory(db);
  const waiting = t.start({ title: "Waiting", origin: "pi" });
  t.append(waiting.id, {
    source: "approval",
    kind: "request",
    participant: "amun",
    summary: "Merge PR 42",
  });
  const failed = t.start({ title: "Failed", origin: "pi" });
  t.append(failed.id, {
    source: "error",
    kind: "failure",
    participant: "engineer",
    summary: "Worker lost",
  });
  const done = t.start({ title: "Done", origin: "pi" });
  t.append(done.id, {
    source: "outcome",
    kind: "final",
    participant: "firstmate",
    summary: "Shipped",
  });
  t.start({ title: "Empty", origin: "pi" });
  const org = new AgentOrg(db);
  const lead = org.register({
    displayName: "Firstmate",
    role: "lead",
    title: "Lead",
    runtime: "pi",
    accountableOwner: "Tamer",
  });
  const eng = org.register({
    displayName: "Engineer",
    role: "eng",
    title: "Engineer",
    runtime: "codex",
    managerId: lead.id,
  });
  org.recordUsage(eng.id, 400, "run-1", new Date("2026-11-10T09:00:00Z"));
  const hb = new Heartbeats(db, clock);
  hb.configure(eng.id, 30);
  hb.configure(lead.id, 30);
  hb.wake(eng.id, "message", "Comment", () => ({
    decision: "escalate",
    detail: "Expiry undecided",
    because: "information",
  }));
  hb.halt(lead.id, "Tamer", "Investigating");
  new TaskCheckout(db, clock).checkout(
    { kind: "work_item", id: "AM-104" },
    { kind: "agent", id: "engineer" },
  );
  const goals = new SessionGoals(db, clock);
  const goal = goals.create({
    sessionRef: waiting.id,
    title: "Ship invites",
    criteria: [{ id: "t", description: "Tests pass", check: "pnpm test" }],
    guardrails: { maxTurns: 1 },
  });
  goals.recordTurn(goal.id, {
    results: [{ id: "t", passed: false, output: "1 failed" }],
  });
  now += 3_600_000;

  const ops = new OperationsData(db);
  expect(ops.sessions().map((s) => [s.title, s.state, s.nextAction])).toEqual([
    ["Waiting", "waiting", "Merge PR 42"],
    ["Failed", "failed", "Worker lost"],
    ["Done", "completed", null],
    ["Empty", "queued", null],
  ]);
  const attention = ops.attention(clock());
  expect(attention.map((a) => [a.kind, a.title]).sort()).toEqual(
    [
      ["approval", "Merge PR 42"],
      ["failure", "Worker lost"],
      ["stuck", "AM-104 has had no update from engineer"],
      ["escalation", "Engineer: Lacks information: Expiry undecided"],
      ["policy_violation", "Firstmate is halted: Tamer: Investigating"],
      ["escalation", "Ship invites is blocked (turn limit)"],
    ].sort(),
  );
  expect(attention.find((a) => a.kind === "approval")?.sessionId).toBe(
    waiting.id,
  );
  expect(ops.usage()).toEqual([
    {
      at: "2026-11-10T09:00:00.000Z",
      agent: "Engineer",
      model: "codex",
      tokens: 0,
      costMicros: 400,
      durationMs: 0,
    },
  ]);
  expect(ops.usage({ from: "2026-11-11T00:00:00Z" })).toEqual([]);
  db.close();
});
