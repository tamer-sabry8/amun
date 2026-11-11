import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { Fleet, maxAttempts } from "../src/fleet.ts";

const open = () => {
  const db = new Database(":memory:");
  migrate(db);
  return db;
};
const tasks = [
  {
    id: "db",
    title: "Tenant model",
    brief: "Add tenant tables",
    contract: "tenants(id)",
  },
  {
    id: "api",
    title: "SAML endpoints",
    brief: "Add endpoints",
    dependsOn: ["db"],
  },
  { id: "docs", title: "Admin guide", brief: "Document setup" },
];

it("runs a plan from decomposition through ordered merges to one delivery", () => {
  const db = open();
  const fleet = new Fleet(db);
  const plan = fleet.plan({
    objective: "Multi-tenant SSO",
    supervisor: "firstmate",
    tasks,
    objectiveRef: "obj-1",
  });
  expect(plan).toMatchObject({ state: "planned", objectiveRef: "obj-1" });
  expect(plan.integrationBranch).toMatch(/^fleet\/[a-f0-9]{8}\/integration$/);
  expect(fleet.overview(plan.id)).toMatchObject({
    readyToStart: ["db", "docs"],
    progress: 0,
  });
  expect(() => fleet.start(plan.id, "api", "w1")).toThrow(/not ready/);
  const started = fleet.start(plan.id, "db", "codex-1");
  expect(started.branch).toBe(`fleet/${plan.id.slice(0, 8)}/db`);
  expect(started.brief).toContain("Interface you must provide:\ntenants(id)");
  fleet.start(plan.id, "docs", "claude-1");
  expect(fleet.get(plan.id).state).toBe("running");
  expect(() => fleet.start(plan.id, "db", "w2")).toThrow(/not ready/);
  fleet.report(plan.id, "docs", "done");
  fleet.report(plan.id, "db", "done");
  expect(fleet.start(plan.id, "api", "codex-2").brief).toContain(
    "- Tenant model: tenants(id)",
  );
  fleet.report(plan.id, "api", "done");
  expect(fleet.mergeQueue(plan.id).map((t) => t.id)).toEqual([
    "db",
    "docs",
    "api",
  ]);
  expect(() => fleet.merged(plan.id, "api")).toThrow(/in order/);
  expect(() => fleet.deliver(plan.id, true)).toThrow(
    /Every subtask must be merged/,
  );
  fleet.merged(plan.id, "db");
  fleet.merged(plan.id, "docs");
  expect(fleet.merged(plan.id, "api").state).toBe("integrating");
  expect(() => fleet.deliver(plan.id, false)).toThrow(
    /Integration tests must pass/,
  );
  expect(fleet.deliver(plan.id, true).state).toBe("delivered");
  expect(() => fleet.start(plan.id, "db", "w")).toThrow(/closed/);
  db.close();
});

it("holds dependants of a failed subtask, retries a limited number of times, then asks for a person", () => {
  const db = open();
  const fleet = new Fleet(db);
  const plan = fleet.plan({ objective: "SSO", supervisor: "firstmate", tasks });
  fleet.start(plan.id, "db", "w");
  expect(() => fleet.report(plan.id, "db", "failed")).toThrow(/Say what/);
  fleet.report(plan.id, "db", "failed", "Migration error");
  expect(fleet.overview(plan.id)).toMatchObject({
    needsAttention: ["db"],
    stalled: { api: ["db"] },
    readyToStart: ["docs"],
  });
  expect(() => fleet.report(plan.id, "db", "done")).toThrow(/not running/);
  for (let attempt = 2; attempt <= maxAttempts; attempt++) {
    expect(fleet.retry(plan.id, "db", "Use the new schema").state).toBe(
      "pending",
    );
    fleet.start(plan.id, "db", "w");
    fleet.report(plan.id, "db", "blocked", "Which column type?");
  }
  expect(() => fleet.retry(plan.id, "db")).toThrow(/needs a person/);
  expect(() => fleet.retry(plan.id, "docs")).toThrow(
    /Only a failed or blocked/,
  );
  expect(fleet.cancel(plan.id).state).toBe("cancelled");
  expect(() =>
    fleet.plan({
      objective: " ",
      supervisor: " ",
      tasks: [{ id: "a", title: "a", brief: "a", dependsOn: ["a"] }],
    }),
  ).toThrow(/depends on itself.*State the objective.*Name the supervisor/);
  db.close();
});
