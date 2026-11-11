import { it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { Trajectory } from "../src/trajectory.ts";
import { Redactor } from "../../security/src/redaction.ts";

const open = () => {
  const db = new Database(":memory:");
  migrate(db);
  db.prepare(
    "INSERT INTO products(id,name,created_at) VALUES('p','Atlas','now')",
  ).run();
  db.prepare(
    "INSERT INTO products(id,name,created_at) VALUES('q','Other','now')",
  ).run();
  return db;
};
const record = (t: Trajectory, id: string) => {
  const ask = t.append(id, {
    source: "user",
    kind: "request",
    participant: "pm",
    summary: "Add invite expiry",
  });
  t.append(id, {
    source: "system",
    kind: "policy",
    participant: "amun",
    summary: "Writes need approval",
  });
  t.append(id, {
    source: "reasoning",
    kind: "plan",
    participant: "firstmate",
    summary: "Change the invite model first",
  });
  const call = t.append(id, {
    source: "tool",
    kind: "call",
    participant: "engineer",
    summary: "Run tests",
    tool: "bash",
    detail: { command: "pnpm test" },
  });
  t.append(id, {
    source: "tool",
    kind: "result",
    participant: "engineer",
    summary: "Tests passed",
    tool: "bash",
    refersTo: call.id,
    status: "ok",
    durationMs: 4000,
    costMicros: 1200,
  });
  return { ask, call };
};

it("records events in order, redacts secrets and withholds confidential detail", () => {
  const db = open();
  const redactor = new Redactor();
  redactor.register("hunter2-super-secret");
  const t = new Trajectory(db, redactor);
  const s = t.start({ title: "Invite expiry", origin: "pi", productId: "p" });
  record(t, s.id);
  const leak = t.append(s.id, {
    source: "tool",
    kind: "call",
    participant: "engineer",
    tool: "curl",
    summary: "Call API with hunter2-super-secret",
    detail: {
      headers: { authorization: "Bearer abc.def" },
      note: "token=xyz123 used hunter2-super-secret",
    },
  });
  const customer = t.append(s.id, {
    source: "context",
    kind: "inject",
    participant: "amun",
    summary: "Customer contract loaded",
    detail: { text: "Acme pays 1,000,000" },
    confidential: true,
  });
  const events = t.events(s.id);
  expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  const stored = JSON.stringify(
    db.prepare("SELECT * FROM trajectory_events").all(),
  );
  expect(stored).not.toContain("hunter2");
  expect(stored).not.toContain("abc.def");
  expect(stored).not.toContain("xyz123");
  expect(stored).not.toContain("Acme pays");
  expect(leak.summary).toContain("[REDACTED]");
  expect(customer.detail).toEqual({ withheld: true, reason: "confidential" });
  expect(customer.summary).toBe("Customer contract loaded");
  db.close();
});

it("refuses edits and deletions in the database and detects tampering", () => {
  const db = open();
  const t = new Trajectory(db);
  const s = t.start({ title: "Run", origin: "pi", productId: "p" });
  record(t, s.id);
  expect(() =>
    db.prepare("UPDATE trajectory_events SET summary='x'").run(),
  ).toThrow(/append-only/);
  expect(() => db.prepare("DELETE FROM trajectory_events").run()).toThrow(
    /append-only/,
  );
  expect(() => db.prepare("DELETE FROM trajectory_sessions").run()).toThrow(
    /retained/,
  );
  expect(t.verify(s.id)).toBe(true);
  db.exec("DROP TRIGGER trajectory_events_no_update");
  db.prepare(
    "UPDATE trajectory_events SET summary='Tests failed' WHERE seq=5",
  ).run();
  expect(t.verify(s.id)).toBe(false);
  db.close();
});

it("validates input and only lets an event refer to its own history", () => {
  const db = open();
  const t = new Trajectory(db);
  const a = t.start({ title: "A", origin: "pi" });
  const b = t.start({ title: "B", origin: "pi" });
  const first = t.append(a.id, {
    source: "user",
    kind: "request",
    participant: "pm",
    summary: "Hi",
  });
  expect(() =>
    t.append(b.id, {
      source: "error",
      kind: "retry",
      participant: "x",
      summary: "Retry",
      refersTo: first.id,
    }),
  ).toThrow(/own history/);
  expect(() =>
    t.append(a.id, {
      source: "nope" as never,
      kind: "x",
      participant: "x",
      summary: "x",
    }),
  ).toThrow();
  expect(() =>
    t.append(a.id, {
      source: "user",
      kind: "Bad Kind",
      participant: "x",
      summary: "x",
    }),
  ).toThrow();
  expect(() =>
    t.append(a.id, {
      source: "user",
      kind: "x",
      participant: "x",
      summary: " ",
    }),
  ).toThrow();
  expect(() =>
    t.append(a.id, {
      source: "user",
      kind: "x",
      participant: "x",
      summary: "x",
      costMicros: -1,
    }),
  ).toThrow();
  expect(() =>
    t.append("missing", {
      source: "user",
      kind: "x",
      participant: "x",
      summary: "x",
    }),
  ).toThrow(/Unknown/);
  expect(() => t.start({ title: " ", origin: "pi" })).toThrow();
  const fix = t.append(a.id, {
    source: "user",
    kind: "correction",
    participant: "pm",
    summary: "I meant hello",
    refersTo: first.id,
  });
  expect(fix.refersTo).toBe(first.id);
  expect(t.events(a.id)[0]?.summary).toBe("Hi");
  db.close();
});

it("searches a session and a product by text, source, tool, status, participant and time", () => {
  const db = open();
  const t = new Trajectory(db);
  const s = t.start({ title: "One", origin: "pi", productId: "p" });
  record(t, s.id);
  const other = t.start({ title: "Two", origin: "pi", productId: "q" });
  t.append(other.id, {
    source: "user",
    kind: "request",
    participant: "pm",
    summary: "Run tests elsewhere",
  });
  expect(
    t.search({ text: "tests" }, { sessionId: s.id }).map((e) => e.seq),
  ).toEqual([4, 5]);
  expect(
    t.search({ sources: ["reasoning"] }, { sessionId: s.id }),
  ).toHaveLength(1);
  expect(
    t
      .search({ tools: ["bash"], statuses: ["ok"] }, { sessionId: s.id })
      .map((e) => e.seq),
  ).toEqual([5]);
  expect(t.search({ participants: ["pm"] }, { productId: "p" })).toHaveLength(
    1,
  );
  expect(
    t.search({ text: "pnpm" }, { productId: "p" }).map((e) => e.seq),
  ).toEqual([4]);
  expect(t.search({ text: "tests" }, { productId: "q" })).toHaveLength(1);
  expect(t.search({ to: "1999-01-01T00:00:00Z" }, { sessionId: s.id })).toEqual(
    [],
  );
  expect(t.sessions("p").map((x) => x.title)).toEqual(["One"]);
  db.close();
});

it("reports what a session needs before it can be resumed", () => {
  const db = open();
  const t = new Trajectory(db);
  const s = t.start({ title: "Run", origin: "pi" });
  expect(t.resume(s.id).state).toBe("empty");
  record(t, s.id);
  expect(t.resume(s.id)).toMatchObject({
    state: "in_progress",
    incomplete: [],
  });
  const ask = t.append(s.id, {
    source: "approval",
    kind: "request",
    participant: "amun",
    summary: "Approve merge of PR 42",
  });
  const call = t.append(s.id, {
    source: "subagent",
    kind: "dispatch",
    participant: "firstmate",
    summary: "Engineer builds signup",
  });
  let brief = t.resume(s.id);
  expect(brief.state).toBe("awaiting_approval");
  expect(brief.approvalsNeeded.map((e) => e.id)).toEqual([ask.id]);
  expect(brief.incomplete.map((e) => e.id)).toEqual([call.id]);
  t.append(s.id, {
    source: "approval",
    kind: "granted",
    participant: "pm",
    summary: "Merge approved",
    refersTo: ask.id,
  });
  const error = t.append(s.id, {
    source: "error",
    kind: "failure",
    participant: "engineer",
    summary: "Worker lost",
    refersTo: call.id,
  });
  expect(t.resume(s.id).state).toBe("failed");
  t.append(s.id, {
    source: "subagent",
    kind: "retry",
    participant: "firstmate",
    summary: "Reattached worker",
    refersTo: error.id,
  });
  t.append(s.id, {
    source: "outcome",
    kind: "final",
    participant: "firstmate",
    summary: "PR 42 merged",
  });
  brief = t.resume(s.id);
  expect(brief.state).toBe("completed");
  expect(brief.lastOutcome?.summary).toBe("PR 42 merged");
  expect(brief.done).toContain("Approval: Merge approved");
  db.close();
});

it("forks keep the original intact, inherit history up to the fork point, and can be compared and promoted", () => {
  const db = open();
  const t = new Trajectory(db);
  const root = t.start({ title: "Main", origin: "pi", productId: "p" });
  const { call } = record(t, root.id);
  t.append(root.id, {
    source: "outcome",
    kind: "final",
    participant: "firstmate",
    summary: "Shipped with expiry of 7 days",
  });
  const branch = t.fork(root.id, call.id, "Try 30 days");
  expect(branch).toMatchObject({
    parentId: root.id,
    forkSeq: 4,
    productId: "p",
  });
  expect(t.events(branch.id).map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  const failed = t.append(branch.id, {
    source: "error",
    kind: "failure",
    participant: "engineer",
    summary: "Migration failed",
    refersTo: call.id,
  });
  expect(failed.seq).toBe(1);
  expect(t.events(root.id)).toHaveLength(6);
  expect(t.events(branch.id)).toHaveLength(5);
  expect(t.verify(root.id) && t.verify(branch.id)).toBe(true);
  const nested = t.fork(branch.id, failed.id, "Retry migration");
  t.append(nested.id, {
    source: "subagent",
    kind: "retry",
    participant: "firstmate",
    summary: "Migration rerun",
    refersTo: failed.id,
  });
  t.append(nested.id, {
    source: "outcome",
    kind: "final",
    participant: "firstmate",
    summary: "Shipped with expiry of 30 days",
    costMicros: 500,
  });
  expect(
    t
      .events(nested.id)
      .map((e) => e.summary)
      .at(-3),
  ).toBe("Migration failed");
  expect(t.root(nested.id).id).toBe(root.id);
  expect(() => t.fork(branch.id, call.id, "x")).toThrow(
    /recorded in this session/,
  );
  let rows = t.compareBranches(nested.id);
  expect(rows.map((r) => [r.title, r.state, r.errors, r.preferred])).toEqual([
    ["Main", "completed", 0, true],
    ["Try 30 days", "failed", 1, false],
    ["Retry migration", "completed", 1, false],
  ]);
  expect(rows[2]).toMatchObject({
    result: "Shipped with expiry of 30 days",
    toolCalls: 1,
    tools: ["bash"],
    costMicros: 500,
  });
  t.promote(nested.id);
  t.promote(nested.id);
  rows = t.compareBranches(root.id);
  expect(rows.filter((r) => r.preferred).map((r) => r.title)).toEqual([
    "Retry migration",
  ]);
  expect(t.branches(root.id)).toHaveLength(3);
  db.close();
});

it("distinguishes a faithful reconstruction from a new run and reports what changed", () => {
  const db = open();
  const t = new Trajectory(db);
  const original = t.start({ title: "Main", origin: "pi" });
  record(t, original.id);
  t.append(original.id, {
    source: "outcome",
    kind: "final",
    participant: "firstmate",
    summary: "All tests pass",
  });
  const copy = t.replay(original.id, "reconstruction");
  expect(copy).toMatchObject({
    replayOf: original.id,
    replayMode: "reconstruction",
  });
  expect(t.events(copy.id).map((e) => e.summary)).toEqual(
    t.events(original.id).map((e) => e.summary),
  );
  expect(t.events(copy.id)[4]?.refersTo).toBe(t.events(copy.id)[3]?.id);
  expect(t.replayComparison(copy.id)).toMatchObject({
    mode: "reconstruction",
    reproduced: true,
    differences: [],
  });
  const rerun = t.replay(original.id, "re_execution");
  expect(t.events(rerun.id)).toEqual([]);
  t.append(rerun.id, {
    source: "user",
    kind: "request",
    participant: "pm",
    summary: "Add invite expiry",
  });
  t.append(rerun.id, {
    source: "system",
    kind: "policy",
    participant: "amun",
    summary: "Writes need approval",
  });
  t.append(rerun.id, {
    source: "reasoning",
    kind: "plan",
    participant: "firstmate",
    summary: "A different thought",
  });
  const call = t.append(rerun.id, {
    source: "tool",
    kind: "call",
    participant: "engineer",
    summary: "Run tests",
    tool: "bash",
  });
  t.append(rerun.id, {
    source: "tool",
    kind: "result",
    participant: "engineer",
    summary: "2 tests failed",
    tool: "bash",
    refersTo: call.id,
  });
  t.append(rerun.id, {
    source: "outcome",
    kind: "final",
    participant: "firstmate",
    summary: "Tests fail",
  });
  const comparison = t.replayComparison(rerun.id, {
    original: { model: "sonnet", bash: "5.2" },
    replay: { model: "opus", bash: "5.2" },
  });
  expect(comparison).toMatchObject({
    mode: "re_execution",
    reproduced: false,
    originalResult: "All tests pass",
    replayResult: "Tests fail",
    changedConditions: ["model: sonnet → opus"],
  });
  expect(comparison.differences.map((d) => d.step)).toEqual([4, 5]);
  expect(() => t.replayComparison(original.id)).toThrow(/not a replay/);
  db.close();
});

it("lists sessions and branches in the order they were created, even within one instant", () => {
  vi.useFakeTimers({ now: new Date("2026-11-10T10:00:00Z") });
  try {
    const db = open();
    const t = new Trajectory(db);
    const root = t.start({ title: "Main", origin: "pi", productId: "p" });
    const first = t.append(root.id, {
      source: "user",
      kind: "request",
      participant: "pm",
      summary: "Start",
    });
    const titles = Array.from({ length: 20 }, (_, i) => "Branch " + i);
    for (const title of titles) t.fork(root.id, first.id, title);
    expect(t.branches(root.id).map((s) => s.title)).toEqual([
      "Main",
      ...titles,
    ]);
    expect(t.sessions("p").map((s) => s.title)).toEqual(["Main", ...titles]);
    expect(t.compareBranches(root.id).map((s) => s.title)).toEqual([
      "Main",
      ...titles,
    ]);
    db.close();
  } finally {
    vi.useRealTimers();
  }
});
