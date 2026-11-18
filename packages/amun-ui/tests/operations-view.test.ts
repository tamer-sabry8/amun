import { it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ClaimsView,
  HeartbeatView,
  PluginCatalogView,
} from "../src/operations-view.tsx";

it("shows who holds each task, for how long, and flags a stalled claim", () => {
  const html = renderToStaticMarkup(
    createElement(ClaimsView, {
      claims: [
        {
          task: { kind: "work_item", id: "AM-104" },
          state: "claimed",
          holder: { kind: "agent", id: "engineer" },
          activity: "Building invites",
          acquiredAt: "2026-11-10T10:00:00Z",
          heldForMs: 95 * 60000,
          stalled: true,
        },
        {
          task: { kind: "work_item", id: "AM-105" },
          state: "waiting_human",
          holder: { kind: "human", id: "Tamer" },
          activity: "",
          acquiredAt: "2026-11-10T11:00:00Z",
          heldForMs: 5 * 60000,
          stalled: false,
        },
      ],
    }),
  );
  expect(html).toContain('data-task-id="AM-104" data-stalled="true"');
  expect(html).toContain("Stalled, no update from holder");
  expect(html).toContain("engineer (agent)");
  expect(html).toContain("1 h 35 min");
  expect(html).toContain("Waiting for a person");
  expect(html).toContain("Reclaim AM-105");
  expect(
    renderToStaticMarkup(createElement(ClaimsView, { claims: [] })),
  ).toContain("No task is held right now.");
});

it("explains each wake and offers the halt or continue control", () => {
  const wakes = [
    {
      id: "w1",
      at: "2026-11-10T10:30:00Z",
      trigger: "blocker_resolved",
      reason: "AM-90 landed",
      decision: "request_approval",
      detail: "Merge PR 42",
      waitingOn: "approval",
    },
  ];
  const running = renderToStaticMarkup(
    createElement(HeartbeatView, {
      agentName: "Engineer",
      wakes,
      waitingOn: "approval",
      nextAt: "2026-11-10T11:00:00Z",
      haltedReason: null,
    }),
  );
  expect(running).toContain(
    "Next check 2026-11-10T11:00:00Z · Waiting on approval",
  );
  expect(running).toContain("Woke because: AM-90 landed (blocker resolved)");
  expect(running).toContain("Asked for approval: Merge PR 42");
  expect(running).toContain("Halt Engineer");
  const halted = renderToStaticMarkup(
    createElement(HeartbeatView, {
      agentName: "Engineer",
      wakes: [],
      waitingOn: "a person",
      nextAt: null,
      haltedReason: "Tamer: Investigating",
    }),
  );
  expect(halted).toContain('data-halted="true"');
  expect(halted).toContain("Halted · Tamer: Investigating");
  expect(halted).toContain("Let Engineer continue");
  expect(halted).toContain("This agent has not woken yet.");
});

it("groups extensions by origin and shows the access each one needs", () => {
  const plugin = (
    id: string,
    origin: "first_party" | "customer" | "third_party",
    state: string,
    compatible = true,
  ) => ({
    manifest: {
      id,
      name: id,
      kind: "connector" as const,
      origin,
      version: "1.0.0",
      description: "Desc " + id,
    },
    state,
    granted: state === "enabled",
    compatible,
    permissions: ["Contacts: " + id + ".example"],
  });
  const html = renderToStaticMarkup(
    createElement(PluginCatalogView, {
      plugins: [
        plugin("partner", "third_party", "installed", false),
        plugin("ours", "customer", "enabled"),
        plugin("core", "first_party", "enabled"),
      ],
    }),
  );
  expect(html.indexOf('aria-label="Built in"')).toBeLessThan(
    html.indexOf('aria-label="Your organisation"'),
  );
  expect(html.indexOf('aria-label="Your organisation"')).toBeLessThan(
    html.indexOf('aria-label="Third party"'),
  );
  expect(html).toContain("Contacts: ours.example");
  expect(html).toContain("Turn off ours");
  expect(html).toContain("Review access and turn on partner");
  expect(html).toContain("Not compatible with this version of Amun");
  expect(html).toContain("Remove core");
  expect(
    renderToStaticMarkup(createElement(PluginCatalogView, { plugins: [] })),
  ).toContain("No extensions are installed.");
});
