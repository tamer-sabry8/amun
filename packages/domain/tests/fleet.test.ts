import { it, expect } from "vitest";
import {
  fleetOverview,
  mergeOrder,
  planProblems,
  readyTasks,
  stalledBy,
  waves,
  workerBrief,
  type FleetTask,
} from "../src/fleet.ts";

const plan = [
  {
    id: "db",
    title: "Tenant model",
    brief: "Add tenant tables",
    contract: "tenants(id, sso_url)",
  },
  {
    id: "api",
    title: "SAML endpoints",
    brief: "Add login endpoints",
    dependsOn: ["db"],
    contract: "POST /sso/login",
  },
  {
    id: "ui",
    title: "Login screen",
    brief: "Add SSO button",
    dependsOn: ["api"],
  },
  { id: "docs", title: "Admin guide", brief: "Document setup" },
];
const task = (
  id: string,
  state: FleetTask["state"],
  dependsOn: string[] = [],
  branch: string | null = null,
): FleetTask => ({
  id,
  title: id,
  brief: "Do " + id,
  contract: "",
  dependsOn,
  state,
  worker: null,
  branch,
  attempts: 0,
  note: "",
});

it("accepts a sound plan and names every problem in a bad one", () => {
  expect(planProblems(plan)).toEqual([]);
  expect(planProblems([])).toEqual(["A plan needs at least one subtask"]);
  expect(
    planProblems([
      { id: "A B", title: "x", brief: "x" },
      { id: "a", title: " ", brief: "x", dependsOn: ["a", "ghost"] },
      { id: "a", title: "x", brief: "x" },
    ]),
  ).toEqual([
    'Subtask id "A B" must be short, lower-case letters, digits and hyphens',
    'Subtask "a" needs a title and a brief',
    'Subtask id "a" is used twice',
    'Subtask "a" depends on itself',
    'Subtask "a" depends on unknown "ghost"',
  ]);
  expect(
    planProblems([
      { id: "a", title: "a", brief: "a", dependsOn: ["b"] },
      { id: "b", title: "b", brief: "b", dependsOn: ["a"] },
    ]),
  ).toEqual(["The subtasks depend on each other in a loop"]);
});

it("groups independent work into parallel waves", () => {
  expect(waves(plan)).toEqual([["db", "docs"], ["api"], ["ui"]]);
});

it("starts only work whose dependencies are finished and reports what is stalled", () => {
  const tasks = [
    task("db", "done"),
    task("api", "pending", ["db"]),
    task("ui", "pending", ["api"]),
    task("docs", "running"),
  ];
  expect(readyTasks(tasks).map((t) => t.id)).toEqual(["api"]);
  const failed = [
    task("db", "failed"),
    task("api", "pending", ["db"]),
    task("ui", "pending", ["api"]),
  ];
  expect(readyTasks(failed)).toEqual([]);
  expect([...stalledBy(failed)]).toEqual([["api", ["db"]]]);
});

it("merges finished branches dependencies first and knows when integration can start", () => {
  const tasks = [
    task("ui", "done", ["api"], "b/ui"),
    task("api", "done", ["db"], "b/api"),
    task("db", "merged", [], "b/db"),
    task("docs", "running"),
  ];
  expect(mergeOrder(tasks).map((t) => t.id)).toEqual(["api", "ui"]);
  expect(fleetOverview(tasks)).toMatchObject({
    total: 4,
    progress: 0.75,
    readyToIntegrate: false,
    needsAttention: [],
    readyToStart: [],
  });
  expect(
    fleetOverview(tasks.map((t) => ({ ...t, state: "merged" as const })))
      .readyToIntegrate,
  ).toBe(true);
  expect(fleetOverview([])).toMatchObject({
    progress: 0,
    readyToIntegrate: false,
  });
  expect(
    fleetOverview([task("x", "blocked"), task("y", "failed")]).needsAttention,
  ).toEqual(["x", "y"]);
});

it("gives a worker its own scope and the contracts it relies on", () => {
  const tasks = plan.map((p) => ({
    ...task(p.id, "pending", p.dependsOn ?? []),
    title: p.title,
    brief: p.brief,
    contract: p.contract ?? "",
  }));
  const brief = workerBrief("Multi-tenant SAML SSO", tasks[1]!, tasks);
  expect(brief).toContain(
    "You are one worker on a larger objective: Multi-tenant SAML SSO",
  );
  expect(brief).toContain("Your subtask: SAML endpoints");
  expect(brief).toContain("Interface you must provide:\nPOST /sso/login");
  expect(brief).toContain("- Tenant model: tenants(id, sso_url)");
  expect(brief).not.toContain("Login screen");
  expect(workerBrief("X", tasks[3]!, tasks)).not.toContain("Already delivered");
});
