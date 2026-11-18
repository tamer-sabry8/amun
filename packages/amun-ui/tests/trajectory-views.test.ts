import { it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TrajectoryEvent } from "../../../packages/domain/src/trajectory.ts";
import {
  compareReplay,
  summarizeBranch,
} from "../../../packages/domain/src/trajectory.ts";
import {
  orgOverview,
  orgTree,
  type Agent,
} from "../../../packages/domain/src/agent-org.ts";
import { TrajectoryView } from "../src/trajectory-view.tsx";
import { GoalsView, OrgChart } from "../src/org-goals-view.tsx";

const event = (
  seq: number,
  changes: Partial<TrajectoryEvent>,
): TrajectoryEvent => ({
  id: "e" + seq,
  sessionId: "s",
  seq,
  at: `2026-11-10T10:0${seq}:00Z`,
  source: "user",
  kind: "request",
  participant: "pm",
  summary: "Event " + seq,
  detail: {},
  refersTo: null,
  status: null,
  tool: null,
  costMicros: null,
  durationMs: null,
  ...changes,
});
const events = [
  event(1, { summary: "Add invite expiry" }),
  event(2, {
    source: "tool",
    kind: "call",
    participant: "engineer",
    tool: "bash",
    summary: "Run tests",
    detail: { command: "pnpm test" },
  }),
  event(3, {
    source: "tool",
    kind: "result",
    participant: "engineer",
    tool: "bash",
    summary: "Tests passed",
    refersTo: "e2",
    status: "ok",
  }),
  event(4, {
    source: "approval",
    kind: "request",
    participant: "amun",
    summary: "Approve merge",
  }),
];

it("shows every event with its source, links follow-ups and reports what the session is waiting for", () => {
  const html = renderToStaticMarkup(
    createElement(TrajectoryView, { title: "Invite expiry", events }),
  );
  expect(html).toContain('aria-label="Trajectory of Invite expiry"');
  expect(html).toContain('data-state="awaiting_approval"');
  expect(html).toContain("Waiting for approval · 4 events · 1 approval needed");
  expect(html).toContain("Showing every event");
  expect(html).toContain('href="#trajectory-e2"');
  expect(html).toContain("Followed by");
  expect(html).toContain("pnpm test");
  expect(html).toContain("Tool: bash");
  expect(html).not.toContain("Model reasoning");
});

it("filters by text and source and groups by source in a fixed order", () => {
  const filtered = renderToStaticMarkup(
    createElement(TrajectoryView, {
      title: "T",
      events,
      initialText: "tests",
      initialSources: ["tool"],
    }),
  );
  expect(filtered).toContain("Showing 2 of 4 events");
  expect(filtered).not.toContain('data-event-id="e1"');
  const grouped = renderToStaticMarkup(
    createElement(TrajectoryView, { title: "T", events, initialGrouped: true }),
  );
  expect(grouped.indexOf('aria-label="User input"')).toBeLessThan(
    grouped.indexOf('aria-label="Tool use"'),
  );
  expect(grouped.indexOf('aria-label="Tool use"')).toBeLessThan(
    grouped.indexOf('aria-label="Approval"'),
  );
  expect(grouped).toContain("What did it do?");
  const none = renderToStaticMarkup(
    createElement(TrajectoryView, { title: "T", events, initialText: "zzz" }),
  );
  expect(none).toContain("No events match.");
});

it("compares branches and labels a replay as a reconstruction or a new run", () => {
  const done = [
    ...events.slice(0, 3),
    event(5, { source: "outcome", kind: "final", summary: "Shipped" }),
  ];
  const branches = [
    { ...summarizeBranch("s", done), title: "Main", preferred: true },
    { ...summarizeBranch("b", events), title: "Alternative", preferred: false },
  ];
  const replay = compareReplay("re_execution", done, events, {
    original: { model: "a" },
    replay: { model: "b" },
  });
  const html = renderToStaticMarkup(
    createElement(TrajectoryView, { title: "T", events, branches, replay }),
  );
  expect(html).toContain("Branches of this session");
  expect(html).toContain("<td>Shipped</td>");
  expect(html).toContain("Prefer Alternative");
  expect(html).toContain("Replay · new run, results may differ");
  expect(html).toContain("The outcome was not reproduced.");
  expect(html).toContain("model: a → b");
  const same = compareReplay("reconstruction", done, done);
  expect(
    renderToStaticMarkup(
      createElement(TrajectoryView, { title: "T", events: done, replay: same }),
    ),
  ).toContain("The outcome was reproduced.");
});

const agent = (id: string, changes: Partial<Agent>): Agent => ({
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

it("shows the organisation with reporting depth, accountability, status and budget", () => {
  const agents = [
    agent("Firstmate", { accountableOwner: "Tamer", title: "Lead" }),
    agent("Engineer", {
      managerId: "Firstmate",
      status: "blocked",
      budgetMicros: 5_000_000,
      budgetPeriod: "day",
    }),
    agent("Stray", { managerId: "gone", status: "needs_attention" }),
  ];
  const html = renderToStaticMarkup(
    createElement(OrgChart, {
      nodes: orgTree(agents),
      overview: orgOverview(agents),
      spent: { Engineer: 1_250_000 },
    }),
  );
  expect(html).toContain(
    "3 agents · 1 active · 1 blocked · 1 need you · 0 paused",
  );
  expect(html).toContain('data-agent-id="Engineer" data-depth="1"');
  expect(html).toContain("Accountable: Tamer");
  expect(html).toContain("Budget 1.25 of 5.00 per day");
  expect(html).toContain("1 direct reports");
  expect(html).toContain('role="alert"');
  expect(html).toContain("Accountable: nobody");
  expect(
    renderToStaticMarkup(
      createElement(OrgChart, { nodes: [], overview: orgOverview([]) }),
    ),
  ).toContain("No agents are registered yet.");
});

it("shows goals with contribution counted apart from linked work", () => {
  const html = renderToStaticMarkup(
    createElement(GoalsView, {
      goals: [
        {
          id: "g",
          depth: 0,
          level: "goal",
          title: "Retention",
          category: "customer retention",
          status: "active",
          linked: 4,
          advanced: 1,
          noEffect: 1,
          setBack: 1,
          unassessed: 1,
        },
        {
          id: "i",
          depth: 1,
          level: "initiative",
          title: "Onboarding",
          category: "customer retention",
          status: "active",
          linked: 2,
          advanced: 1,
          noEffect: 1,
          setBack: 0,
          unassessed: 0,
        },
      ],
    }),
  );
  expect(html).toContain("Finished work is counted separately");
  expect(html).toContain('data-goal-id="i" data-depth="1"');
  expect(html).toContain("<td>4</td><td>1</td><td>1</td><td>1</td><td>1</td>");
  expect(
    renderToStaticMarkup(createElement(GoalsView, { goals: [] })),
  ).toContain("No goals are defined yet.");
});
