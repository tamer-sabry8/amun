import { it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  attentionQueue,
  capacityBoard,
  liveOperations,
  qualityReport,
  scheduleBoard,
} from "../../../packages/domain/src/operations.ts";
import {
  fleetOverview,
  type FleetTask,
} from "../../../packages/domain/src/fleet.ts";
import {
  classifyTool,
  knownTools,
} from "../../../packages/domain/src/tool-detection.ts";
import {
  ControlTower,
  FleetView,
  PortBadge,
  ToolSetupView,
} from "../src/control-tower-view.tsx";

const now = new Date("2026-11-10T12:00:00Z");

it("answers the four questions and lets an operator act and drill into a session", () => {
  const live = liveOperations(
    [
      {
        id: "s1",
        title: "Invite expiry",
        owner: "engineer",
        state: "active",
        stage: "tool",
        startedAt: "2026-11-10T10:00:00Z",
        lastActivityAt: "2026-11-10T11:00:00Z",
        nextAction: null,
      },
      {
        id: "s2",
        title: "SSO",
        owner: "qa",
        state: "completed",
        stage: "outcome",
        startedAt: "2026-11-10T09:00:00Z",
        lastActivityAt: "2026-11-10T11:59:00Z",
        nextAction: null,
      },
    ],
    now,
  );
  const attention = attentionQueue(
    [
      {
        id: "a1",
        kind: "approval",
        title: "Merge PR 42",
        sessionId: "s1",
        severity: 1,
        customerImpact: true,
        businessImpact: 2,
        deadlineAt: "2026-11-10T11:00:00Z",
        raisedAt: "2026-11-10T10:30:00Z",
      },
    ],
    now,
  );
  const html = renderToStaticMarkup(
    createElement(ControlTower, {
      live,
      attention,
      schedules: scheduleBoard(
        [
          {
            id: "t",
            name: "Daily brief",
            owner: "ops",
            schedule: "Daily 09:00",
            nextAt: "2026-11-10T09:00:00Z",
            lastRunAt: null,
            lastSuccessAt: null,
            consecutiveFailures: 0,
          },
        ],
        now,
      ),
      capacity: capacityBoard([
        {
          name: "Claude",
          kind: "provider_rate",
          used: 10,
          limit: 10,
          waiting: 2,
        },
      ]),
      quality: qualityReport([
        {
          sessionId: "s9",
          at: "2026-11-10T08:00:00Z",
          result: "failure",
          retries: 0,
          humanInterventions: 0,
          approvalsRequested: 0,
          approvalsGranted: 0,
          resolutionMs: 1,
        },
      ]),
    }),
  );
  expect(html).toContain(
    "<dt>Happening now</dt><dd>1 active · 0 queued · 0 waiting</dd>",
  );
  expect(html).toContain("<dt>Needs attention</dt><dd>1 need you</dd>");
  expect(html).toContain(
    "<dt>At risk</dt><dd>1 stuck · 1 overdue · 1 limits tight</dd>",
  );
  expect(html).toContain(
    "<dt>Accomplished</dt><dd>1 completed · 0% success</dd>",
  );
  expect(html).toContain('data-attention-id="a1" data-overdue="true"');
  expect(html).toContain("Approve Merge PR 42");
  expect(html).toContain("Open trajectory for Merge PR 42");
  expect(html).toContain('data-session-id="s1" data-stuck="true"');
  expect(html).toContain("Stuck, no recent activity");
  expect(html).toContain("Missed by 3 h 0 min");
  expect(html).toContain(
    "2 waiting on the Claude limit, not because anything failed",
  );
  expect(html).toContain("Open failed session s9");
  expect(html).toContain("Approvals granted No data");
});

it("shows empty states for every section", () => {
  const html = renderToStaticMarkup(
    createElement(ControlTower, {
      live: liveOperations([], now),
      attention: [],
      schedules: [],
      capacity: [],
      quality: qualityReport([]),
    }),
  );
  for (const text of [
    "Nothing needs you right now.",
    "No agent sessions yet.",
    "Nothing is scheduled.",
    "No limits are reported.",
    "<dd>Nothing at risk</dd>",
  ])
    expect(html).toContain(text);
});

it("shows a fleet with one tile per worker, tool setup with next steps, and the port badge", () => {
  const tasks: FleetTask[] = [
    {
      id: "db",
      title: "Tenant model",
      brief: "",
      contract: "",
      dependsOn: [],
      state: "merged",
      worker: "codex-1",
      branch: "fleet/x/db",
      attempts: 1,
      note: "",
    },
    {
      id: "api",
      title: "SAML endpoints",
      brief: "",
      contract: "",
      dependsOn: ["db"],
      state: "blocked",
      worker: "claude-1",
      branch: "fleet/x/api",
      attempts: 1,
      note: "Which provider?",
    },
  ];
  const fleet = renderToStaticMarkup(
    createElement(FleetView, {
      objective: "Multi-tenant SSO",
      supervisor: "Firstmate",
      overview: fleetOverview(tasks),
      tasks,
    }),
  );
  expect(fleet).toContain(
    "Supervisor Firstmate · 50% finished · 0 working · 1 need attention",
  );
  expect(fleet).toContain('data-task-id="api" data-state="blocked"');
  expect(fleet).toContain("Has a question");
  expect(fleet).toContain("After: db");
  expect(fleet).toContain("Which provider?");
  const tool = (id: string) => knownTools.find((t) => t.id === id)!;
  const tools = renderToStaticMarkup(
    createElement(ToolSetupView, {
      tools: [
        classifyTool(tool("claude_code"), {
          found: true,
          versionText: "2.1.321",
          signedIn: false,
        }),
        classifyTool(tool("codex"), { found: false }),
        classifyTool(
          tool("tmux"),
          { found: true, versionText: "tmux 3.8" },
          { enabled: false, isDefault: false, origin: "detected" },
        ),
      ],
    }),
  );
  expect(tools).toContain(
    'data-tool-id="claude_code" data-status="needs_sign_in"',
  );
  expect(tools).toContain("Next: Sign in: claude auth login");
  expect(tools).toContain("Found, needs sign-in");
  expect(tools).toContain("Turn on tmux");
  expect(tools).not.toContain("Turn off Codex CLI");
  expect(tools).toContain(
    "Prompts, code and context the agent reads are sent to the tool",
  );
  expect(
    renderToStaticMarkup(
      createElement(PortBadge, {
        port: 4102,
        health: "healthy",
        taskTitle: "Invites",
      }),
    ),
  ).toBe(
    '<a class="port-badge" href="http://127.0.0.1:4102/" data-health="healthy" aria-label="Invites preview on :4102, Running">:4102</a>',
  );
  expect(
    renderToStaticMarkup(
      createElement(PortBadge, {
        port: 4102,
        health: "stopped",
        taskTitle: "Invites",
      }),
    ),
  ).toContain("<span");
});
