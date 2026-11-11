import { it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { Goals } from "../src/goals.ts";
import { AgentOrg } from "../src/agent-org.ts";

const open = () => {
  const db = new Database(":memory:");
  migrate(db);
  return db;
};

it("builds a goal hierarchy within the administrator's taxonomy", () => {
  const db = open();
  const goals = new Goals(db);
  expect(goals.policy().categories).toContain("customer retention");
  expect(() => goals.create({ title: "Grow", category: "vibes" })).toThrow(
    /taxonomy/,
  );
  goals.setPolicy({
    categories: ["Retention", "retention", " Quality "],
    required: [],
  });
  expect(goals.policy().categories).toEqual(["retention", "quality"]);
  expect(() => goals.setPolicy({ categories: [], required: [] })).toThrow();
  expect(() =>
    goals.setPolicy({ categories: ["x"], required: ["nope" as never] }),
  ).toThrow();
  const goal = goals.create({
    title: "Keep enterprise customers",
    category: "retention",
    why: "Churn doubled",
    success: "Churn under 2%",
  });
  const initiative = goals.create({
    title: "Team onboarding",
    parentId: goal.id,
  });
  const project = goals.create({
    title: "Invites",
    parentId: initiative.id,
    level: "project",
    priority: 1,
  });
  expect(initiative).toMatchObject({
    level: "initiative",
    category: "retention",
  });
  expect(goals.lineage(project.id).map((g) => g.title)).toEqual([
    "Keep enterprise customers",
    "Team onboarding",
    "Invites",
  ]);
  expect(goals.subtree(goal.id).map((g) => g.level)).toEqual([
    "goal",
    "initiative",
    "project",
  ]);
  expect(() =>
    goals.create({ title: "Loose", level: "project", category: "retention" }),
  ).toThrow(/belong to a goal/);
  expect(() =>
    goals.create({ title: "Up", parentId: project.id, level: "initiative" }),
  ).toThrow(/below/);
  expect(() =>
    goals.create({ title: "Top", parentId: goal.id, level: "goal" }),
  ).toThrow(/top/);
  expect(() =>
    goals.create({ title: "P", category: "retention", priority: 9 }),
  ).toThrow(/Priority/);
  db.close();
});

it("traces work up to its goal and down from a goal, and gives the agent the goal context", () => {
  const db = open();
  const goals = new Goals(db);
  const goal = goals.create({
    title: "Keep enterprise customers",
    category: "customer retention",
    why: "Churn doubled last quarter",
    beneficiaries: "Workspace admins",
    success: "Churn under 2%",
    constraints: "No pricing changes",
    rules: "Admins approve every invite",
  });
  const initiative = goals.create({
    title: "Team onboarding",
    parentId: goal.id,
    success: "Admins invite teammates in under a minute",
  });
  goals.link(initiative.id, "work_item", "AM-104");
  goals.link(initiative.id, "work_item", "AM-104");
  goals.link(goal.id, "objective", "obj-1");
  goals.link(initiative.id, "run", "run-9");
  expect(goals.links(initiative.id)).toHaveLength(2);
  expect(
    goals
      .contributors(goal.id)
      .map((l) => l.targetId)
      .sort(),
  ).toEqual(["AM-104", "obj-1", "run-9"]);
  expect(
    goals
      .goalsFor("work_item", "AM-104")
      .map((path) => path.map((g) => g.title)),
  ).toEqual([["Keep enterprise customers", "Team onboarding"]]);
  expect(goals.context("work_item", "AM-104")).toBe(
    [
      "Goal: Keep enterprise customers › Team onboarding",
      "Category: customer retention · Priority 3",
      "Why it matters: Churn doubled last quarter",
      "Who benefits: Workspace admins",
      "Success looks like: Admins invite teammates in under a minute",
      "Constraints: No pricing changes",
      "Business rules: Admins approve every invite",
    ].join("\n"),
  );
  expect(goals.context("work_item", "unlinked")).toBe("");
  expect(() => goals.link(goal.id, "nope" as never, "x")).toThrow();
  goals.setStatus(initiative.id, "dropped");
  expect(() => goals.link(initiative.id, "run", "run-10")).toThrow(/dropped/);
  db.close();
});

it("applies the alignment rule only to the kinds of work the policy names", () => {
  const db = open();
  const goals = new Goals(db);
  const goal = goals.create({ title: "Quality", category: "product quality" });
  expect(goals.aligned("run", "run-1")).toBe(true);
  goals.setPolicy({ ...goals.policy(), required: ["run"] });
  expect(goals.aligned("run", "run-1")).toBe(false);
  expect(goals.aligned("work_item", "AM-1")).toBe(true);
  goals.link(goal.id, "run", "run-1");
  expect(goals.aligned("run", "run-1")).toBe(true);
  db.close();
});

it("reports contribution separately from completion, by agent and with cost", () => {
  const db = open();
  const goals = new Goals(db);
  const org = new AgentOrg(db);
  const eng = org.register({
    displayName: "Engineer",
    role: "engineer",
    title: "Engineer",
    runtime: "codex",
    accountableOwner: "Tamer",
  });
  const qa = org.register({
    displayName: "QA",
    role: "qa",
    title: "QA",
    runtime: "pi",
    accountableOwner: "Tamer",
  });
  const goal = goals.create({
    title: "Retention",
    category: "customer retention",
  });
  const child = goals.create({ title: "Onboarding", parentId: goal.id });
  goals.link(child.id, "run", "run-1", eng.id);
  goals.link(child.id, "run", "run-2", eng.id);
  goals.link(goal.id, "run", "run-3", qa.id);
  goals.link(goal.id, "decision", "d-1");
  org.recordUsage(eng.id, 300, "run-1");
  org.recordUsage(eng.id, 200, "run-2");
  org.recordUsage(qa.id, 50, "unrelated");
  expect(goals.report(goal.id)).toMatchObject({
    linked: 4,
    unassessed: 4,
    advancedShare: null,
    costMicros: 500,
  });
  expect(() => goals.assess(child.id, "run", "run-1", "advanced", " ")).toThrow(
    /why/,
  );
  expect(() =>
    goals.assess(child.id, "run", "missing", "advanced", "x"),
  ).toThrow(/not linked/);
  goals.assess(child.id, "run", "run-1", "advanced", "Invite completion rose");
  goals.assess(
    child.id,
    "run",
    "run-2",
    "no_effect",
    "Finished, but nobody uses it",
  );
  goals.assess(goal.id, "run", "run-3", "set_back", "Regression in sign-in");
  const report = goals.report(goal.id);
  expect(report).toMatchObject({
    linked: 4,
    advanced: 1,
    noEffect: 1,
    setBack: 1,
    unassessed: 1,
  });
  expect(report.advancedShare).toBeCloseTo(1 / 3);
  expect(report.byAgent).toEqual(
    [
      { agentId: eng.id, linked: 2, advanced: 1 },
      { agentId: qa.id, linked: 1, advanced: 0 },
    ].sort((x, y) => x.agentId.localeCompare(y.agentId)),
  );
  expect(goals.report(child.id)).toMatchObject({
    linked: 2,
    advanced: 1,
    costMicros: 500,
  });
  expect(goals.links(child.id)[1]?.note).toBe("Finished, but nobody uses it");
  db.close();
});

it("returns links and the goals a piece of work serves in the order they were linked, even within one instant", () => {
  vi.useFakeTimers({ now: new Date("2026-11-10T10:00:00Z") });
  try {
    const db = open();
    const goals = new Goals(db);
    const names = Array.from({ length: 12 }, (_, i) => "Goal " + (11 - i));
    const ids = names.map(
      (title) => goals.create({ title, category: "product quality" }).id,
    );
    for (const id of ids) goals.link(id, "run", "run-1");
    expect(
      goals.goalsFor("run", "run-1").map((path) => path[0]!.title),
    ).toEqual(names);
    const targets = ["z", "m", "a", "q"];
    for (const target of targets) goals.link(ids[0]!, "work_item", target);
    expect(
      goals
        .links(ids[0]!)
        .filter((link) => link.kind === "work_item")
        .map((link) => link.targetId),
    ).toEqual(targets);
    db.close();
  } finally {
    vi.useRealTimers();
  }
});
