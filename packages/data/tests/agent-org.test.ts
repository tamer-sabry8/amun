import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { AgentOrg } from "../src/agent-org.ts";

const open = () => {
  const db = new Database(":memory:");
  migrate(db);
  return db;
};
const base = { role: "engineer", title: "Engineer", runtime: "claude_code" };

it("requires an accountable owner or a manager and resolves accountability up the line", () => {
  const db = open();
  const org = new AgentOrg(db);
  expect(() => org.register({ ...base, displayName: "Orphan" })).toThrow(
    /accountable/,
  );
  const lead = org.register({
    ...base,
    displayName: "Firstmate",
    role: "lead",
    title: "Lead",
    runtime: "pi",
    accountableOwner: "Tamer",
  });
  const eng = org.register({
    ...base,
    displayName: "Engineer",
    managerId: lead.id,
  });
  const ext = org.register({
    ...base,
    displayName: "Support bot",
    runtime: "external",
    externalRef: "crm://bot/7",
    managerId: eng.id,
    accountableOwner: "Support team",
  });
  expect(
    org
      .tree()
      .map((n) => [n.agent.displayName, n.depth, n.accountable, n.reports]),
  ).toEqual([
    ["Firstmate", 0, "Tamer", 1],
    ["Engineer", 1, "Tamer", 1],
    ["Support bot", 2, "Support team", 0],
  ]);
  expect(ext.externalRef).toBe("crm://bot/7");
  expect(org.overview()).toMatchObject({
    total: 3,
    active: 3,
    unaccountable: [],
  });
  expect(() =>
    org.register({ ...base, displayName: "X", managerId: "missing" }),
  ).toThrow(/Unknown agent/);
  db.close();
});

it("refuses reporting loops and keeps identity when an agent moves", () => {
  const db = open();
  const org = new AgentOrg(db);
  const a = org.register({
    ...base,
    displayName: "A",
    accountableOwner: "Tamer",
  });
  const b = org.register({ ...base, displayName: "B", managerId: a.id });
  const c = org.register({ ...base, displayName: "C", managerId: b.id });
  expect(() => org.reassign(a.id, c.id)).toThrow(/report to itself/);
  expect(() => org.reassign(a.id, a.id)).toThrow(/report to itself/);
  expect(() => org.reassign(c.id, null)).toThrow(/accountable owner/);
  org.recordUsage(c.id, 10, "run-1");
  const moved = org.reassign(c.id, a.id);
  expect(moved).toMatchObject({ id: c.id, managerId: a.id });
  expect(org.spent(c.id)).toBe(10);
  expect(org.reassign(c.id, null, "Ops").accountableOwner).toBe("Ops");
  const renamed = org.update(b.id, { title: "Senior engineer" });
  expect(renamed).toMatchObject({
    id: b.id,
    title: "Senior engineer",
    managerId: a.id,
  });
  db.close();
});

it("allows only in-scope, in-budget, in-schedule work by an active agent", () => {
  const db = open();
  const org = new AgentOrg(db);
  const agent = org.register({
    ...base,
    displayName: "Engineer",
    accountableOwner: "Tamer",
    scopes: { products: ["p"], tools: ["bash", "git"], actions: ["open_pr"] },
    budget: { micros: 1000, period: "day" },
    schedule: { days: [1, 2, 3, 4, 5], fromHour: 8, toHour: 18 },
  });
  const monday = new Date("2026-11-09T10:00:00Z");
  expect(
    org.refusals(agent.id, {
      product: "p",
      tool: "bash",
      action: "open_pr",
      costMicros: 400,
      at: monday,
    }),
  ).toEqual([]);
  expect(
    org.refusals(agent.id, {
      product: "q",
      tool: "curl",
      action: "merge_pr",
      data: "customers",
      at: monday,
    }),
  ).toEqual([
    "product_out_of_scope",
    "tool_out_of_scope",
    "action_out_of_scope",
    "data_out_of_scope",
  ]);
  expect(
    org.refusals(agent.id, { at: new Date("2026-11-08T10:00:00Z") }),
  ).toEqual(["outside_schedule"]);
  expect(
    org.refusals(agent.id, { at: new Date("2026-11-09T20:00:00Z") }),
  ).toEqual(["outside_schedule"]);
  org.recordUsage(agent.id, 700, "run-1", new Date("2026-11-09T09:00:00Z"));
  expect(org.refusals(agent.id, { costMicros: 400, at: monday })).toEqual([
    "over_budget",
  ]);
  expect(org.refusals(agent.id, { costMicros: 300, at: monday })).toEqual([]);
  expect(
    org.refusals(agent.id, {
      costMicros: 400,
      at: new Date("2026-11-10T10:00:00Z"),
    }),
  ).toEqual([]);
  org.setStatus(agent.id, "paused");
  expect(org.refusals(agent.id, { at: monday })).toEqual(["paused"]);
  org.setStatus(agent.id, "retired");
  expect(org.refusals(agent.id, { at: monday })).toEqual(["retired"]);
  expect(org.overview().total).toBe(0);
  expect(() =>
    org.register({
      ...base,
      displayName: "Z",
      accountableOwner: "T",
      budget: { micros: -1, period: "day" },
    }),
  ).toThrow(/budget/);
  expect(() => org.recordUsage(agent.id, -5)).toThrow();
  db.close();
});

it("assigns agents to work and records collaborators without changing identity", () => {
  const db = open();
  const org = new AgentOrg(db);
  const a = org.register({
    ...base,
    displayName: "A",
    accountableOwner: "Tamer",
  });
  const b = org.register({
    ...base,
    displayName: "B",
    accountableOwner: "Tamer",
    status: "blocked",
  });
  org.assign(a.id, "project", "onboarding");
  org.assign(a.id, "project", "onboarding");
  org.assign(a.id, "customer", "acme");
  org.assign(b.id, "project", "onboarding");
  expect(org.assignments(a.id)).toEqual([
    { kind: "customer", targetId: "acme" },
    { kind: "project", targetId: "onboarding" },
  ]);
  expect(
    org.assignedTo("project", "onboarding").map((x) => x.displayName),
  ).toEqual(["A", "B"]);
  org.unassign(a.id, "customer", "acme");
  expect(org.assignments(a.id)).toHaveLength(1);
  org.collaborate(b.id, a.id);
  org.collaborate(a.id, b.id);
  expect(org.collaborators(a.id).map((x) => x.id)).toEqual([b.id]);
  expect(org.collaborators(b.id).map((x) => x.id)).toEqual([a.id]);
  expect(() => org.collaborate(a.id, a.id)).toThrow();
  expect(org.overview()).toMatchObject({ total: 2, active: 1, blocked: 1 });
  db.close();
});
