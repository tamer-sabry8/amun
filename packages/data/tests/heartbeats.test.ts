import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { AgentOrg } from "../src/agent-org.ts";
import { Heartbeats } from "../src/heartbeats.ts";

const setup = () => {
  const db = new Database(":memory:");
  migrate(db);
  let now = Date.parse("2026-11-10T10:00:00Z");
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
    role: "engineer",
    title: "Engineer",
    runtime: "codex",
    managerId: lead.id,
    budget: { micros: 1000, period: "day" },
  });
  const hb = new Heartbeats(db, () => new Date(now));
  return {
    db,
    org,
    hb,
    lead,
    eng,
    advance: (minutes: number) => (now += minutes * 60000),
    at: () => new Date(now),
  };
};

it("wakes an agent on its cadence and records why, what it decided and when it acts next", () => {
  const { db, hb, eng, advance } = setup();
  expect(() => hb.heartbeat(eng.id)).toThrow(/no heartbeat/);
  expect(hb.configure(eng.id, 30)).toMatchObject({
    cadenceMinutes: 30,
    nextAt: "2026-11-10T10:30:00.000Z",
  });
  expect(() => hb.configure(eng.id, 0)).toThrow();
  expect(hb.due()).toEqual([]);
  advance(30);
  expect(hb.due().map((h) => h.agentId)).toEqual([eng.id]);
  const wake = hb.wake(eng.id, "schedule", "30 minutes passed", () => ({
    decision: "wait",
    detail: "PR is in review",
    waitingOn: "review of PR 42",
  }));
  expect(wake).toMatchObject({
    trigger: "schedule",
    decision: "wait",
    waitingOn: "review of PR 42",
    nextAt: "2026-11-10T11:00:00.000Z",
  });
  expect(hb.due()).toEqual([]);
  expect(hb.state(eng.id)).toMatchObject({
    waitingOn: "review of PR 42",
    nextAt: "2026-11-10T11:00:00.000Z",
    last: { id: wake.id },
  });
  expect(() =>
    hb.wake(eng.id, "nope" as never, "x", () => ({
      decision: "act",
      detail: "x",
    })),
  ).toThrow();
  expect(() =>
    hb.wake(eng.id, "message", " ", () => ({ decision: "act", detail: "x" })),
  ).toThrow();
  expect(() =>
    hb.wake(eng.id, "message", "Comment", () => ({
      decision: "act",
      detail: " ",
    })),
  ).toThrow(/explanation/);
  db.close();
});

it("delegates and escalates along the org chart and keeps both traceable to the objective", () => {
  const { db, hb, lead, eng, advance } = setup();
  hb.configure(lead.id, 60);
  hb.configure(eng.id, 60);
  const assigned = hb.wake(
    lead.id,
    "assignment",
    "Story AM-104 assigned",
    () => ({
      decision: "delegate",
      detail: "Engineer builds the invite form",
      to: eng.id,
    }),
    { objectiveRef: "obj-1" },
  );
  expect(assigned).toMatchObject({
    decision: "delegate",
    counterpartId: eng.id,
    waitingOn: "Engineer",
    objectiveRef: "obj-1",
  });
  expect(hb.due().map((h) => h.agentId)).toEqual([eng.id]);
  const stuck = hb.wake(
    eng.id,
    "delegation",
    "Delegated by Firstmate",
    () => ({
      decision: "escalate",
      detail: "Expiry length is undecided",
      because: "information",
    }),
    { parentWakeId: assigned.id },
  );
  expect(stuck).toMatchObject({
    decision: "escalate",
    counterpartId: lead.id,
    objectiveRef: "obj-1",
    parentWakeId: assigned.id,
    detail: "Lacks information: Expiry length is undecided",
  });
  expect(hb.due().map((h) => h.agentId)).toEqual([lead.id]);
  advance(1);
  const top = hb.wake(
    lead.id,
    "escalation",
    "Engineer escalated",
    () => ({
      decision: "escalate",
      detail: "Needs a product decision",
      because: "authority",
    }),
    { parentWakeId: stuck.id },
  );
  expect(top.counterpartId).toBe("Tamer");
  expect(hb.trace("obj-1").map((w) => w.decision)).toEqual([
    "delegate",
    "escalate",
    "escalate",
  ]);
  expect(() =>
    hb.wake(lead.id, "message", "x", () => ({
      decision: "delegate",
      detail: "x",
      to: lead.id,
    })),
  ).toThrow(/itself/);
  db.close();
});

it("stops runaway execution: hourly limit, action streak, budget, pause and human halt", () => {
  const { db, org, hb, eng, advance, at } = setup();
  hb.configure(eng.id, 5, { maxWakesPerHour: 3, maxConsecutiveActs: 2 });
  let called = 0;
  const act = () => {
    called++;
    return {
      decision: "act" as const,
      detail: "Push a commit",
      costMicros: 100,
    };
  };
  expect(hb.wake(eng.id, "message", "Comment 1", act).decision).toBe("act");
  expect(hb.wake(eng.id, "message", "Comment 2", act).decision).toBe("act");
  const third = hb.wake(eng.id, "message", "Comment 3", act);
  expect(third).toMatchObject({
    decision: "refused",
    waitingOn: "a person",
    nextAt: null,
  });
  expect(hb.heartbeat(eng.id).haltedReason).toContain("Too many actions");
  const blocked = hb.wake(eng.id, "message", "Comment 4", act);
  expect(blocked).toMatchObject({ decision: "refused" });
  expect(blocked.detail).toContain("Halted by system");
  expect(called).toBe(3);
  expect(hb.due()).toEqual([]);
  expect(hb.state(eng.id)).toMatchObject({
    waitingOn: "a person",
    nextAt: null,
  });
  const status = hb.wake(
    eng.id,
    "human_request",
    "Tamer asked for status",
    () => ({
      decision: "wait",
      detail: "Halted; two commits pushed",
      waitingOn: "release",
    }),
  );
  expect(status.decision).toBe("wait");
  hb.release(eng.id);
  advance(61);
  org.recordUsage(eng.id, 950, undefined, at());
  expect(hb.wake(eng.id, "schedule", "Cadence", act)).toMatchObject({
    decision: "refused",
    waitingOn: "budget",
    detail: "Not allowed: over_budget",
  });
  hb.wake(eng.id, "schedule", "Cadence", () => ({
    decision: "request_approval",
    detail: "Merge PR 42",
  }));
  hb.wake(eng.id, "schedule", "Cadence", () => ({
    decision: "wait",
    detail: "x",
    waitingOn: "y",
  }));
  expect(hb.wake(eng.id, "schedule", "Cadence", act)).toMatchObject({
    decision: "refused",
    waitingOn: "the hourly limit",
  });
  advance(61);
  org.setStatus(eng.id, "paused");
  expect(hb.wake(eng.id, "schedule", "Cadence", act)).toMatchObject({
    decision: "refused",
    detail: "Paused",
  });
  expect(hb.due()).toEqual([]);
  expect(() => hb.halt(eng.id, " ", "x")).toThrow();
  expect(hb.halt(eng.id, "Tamer", "Investigating").haltedReason).toBe(
    "Tamer: Investigating",
  );
  expect(hb.wakes(eng.id).length).toBe(10);
  db.close();
});
