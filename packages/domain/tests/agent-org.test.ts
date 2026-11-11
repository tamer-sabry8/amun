import { it, expect } from "vitest";
import {
  accountableFor,
  directReports,
  managementChain,
  orgTree,
  peers,
  periodStart,
  permissionRefusals,
  withinSchedule,
  wouldLoop,
  type Agent,
} from "../src/agent-org.ts";

const agent = (id: string, changes: Partial<Agent> = {}): Agent => ({
  id,
  displayName: id,
  role: "engineer",
  title: "Engineer",
  description: "",
  runtime: "codex",
  externalRef: null,
  accountableOwner: null,
  managerId: null,
  status: "active",
  scopes: {},
  budgetMicros: null,
  budgetPeriod: null,
  schedule: {},
  escalation: null,
  ...changes,
});
const agents = [
  agent("lead", { accountableOwner: "Tamer" }),
  agent("eng", { managerId: "lead" }),
  agent("qa", { managerId: "lead" }),
  agent("intern", { managerId: "eng" }),
];

it("walks the reporting line and finds managers, reports and peers", () => {
  expect(managementChain(agents, "intern").map((a) => a.id)).toEqual([
    "eng",
    "lead",
  ]);
  expect(directReports(agents, "lead").map((a) => a.id)).toEqual(["eng", "qa"]);
  expect(peers(agents, "eng").map((a) => a.id)).toEqual(["qa"]);
  expect(peers(agents, "lead")).toEqual([]);
  expect(accountableFor(agents, "intern")).toBe("Tamer");
  expect(accountableFor(agents, "missing")).toBeNull();
});

it("detects loops and survives a loop already present in the data", () => {
  expect(wouldLoop(agents, "lead", "intern")).toBe(true);
  expect(wouldLoop(agents, "eng", "eng")).toBe(true);
  expect(wouldLoop(agents, "intern", "qa")).toBe(false);
  expect(wouldLoop(agents, "lead", null)).toBe(false);
  const looped = [
    agent("a", { managerId: "b" }),
    agent("b", { managerId: "a" }),
  ];
  expect(managementChain(looped, "a").map((x) => x.id)).toEqual(["b"]);
  expect(accountableFor(looped, "a")).toBeNull();
  expect(orgTree(looped)).toEqual([]);
});

it("treats a missing scope list as no access and a star as all", () => {
  const list = [
    agent("open", { accountableOwner: "T", scopes: { tools: ["*"] } }),
    agent("closed", { accountableOwner: "T" }),
  ];
  expect(permissionRefusals(list, "open", { tool: "anything" })).toEqual([]);
  expect(permissionRefusals(list, "closed", { tool: "bash" })).toEqual([
    "tool_out_of_scope",
  ]);
  expect(permissionRefusals(list, "nobody", {})).toEqual(["unaccountable"]);
  expect(permissionRefusals([agent("x")], "x", {})).toEqual(["unaccountable"]);
});

it("handles overnight schedules and budget period starts", () => {
  const night = { fromHour: 22, toHour: 6 };
  expect(withinSchedule(night, new Date("2026-11-09T23:00:00Z"))).toBe(true);
  expect(withinSchedule(night, new Date("2026-11-09T03:00:00Z"))).toBe(true);
  expect(withinSchedule(night, new Date("2026-11-09T12:00:00Z"))).toBe(false);
  expect(withinSchedule({}, new Date())).toBe(true);
  const at = new Date("2026-11-11T15:30:00Z");
  expect(periodStart("day", at).toISOString()).toBe("2026-11-11T00:00:00.000Z");
  expect(periodStart("week", at).toISOString()).toBe(
    "2026-11-09T00:00:00.000Z",
  );
  expect(periodStart("month", at).toISOString()).toBe(
    "2026-11-01T00:00:00.000Z",
  );
  expect(periodStart("total", at).getTime()).toBe(0);
});
