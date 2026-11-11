import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { ElementFeedback } from "../src/element-feedback.ts";

const open = () => {
  const db = new Database(":memory:");
  migrate(db);
  return db;
};
const capture = {
  url: "http://127.0.0.1:5173/invite?token=abc123#x",
  selector: "button.primary",
  label: "Send invite",
  role: "button",
  text: "Send invite to dana@acme.example",
  rect: { x: 900, y: 40, width: 400, height: 36.4 },
  viewport: { width: 1200, height: 800 },
  styles: {
    color: "rgb(255,255,255)",
    "background-color": "rgb(99,26,134)",
    overflow: "visible",
    cursor: "pointer",
  },
  accessibility: ["Contrast 3.1:1 is below 4.5:1"],
  consoleErrors: [
    "TypeError: x is undefined at invite.js:10 for dana@acme.example",
  ],
  networkFailures: ["POST /api/invites 500"],
  screenshotRef: "captures/invite-1.png",
  nearby: ["Email address", "Cancel"],
  onclick: "alert(1)",
};

it("shares a cleaned, masked capture and tells the agent to name the element first", () => {
  const db = open();
  const feedback = new ElementFeedback(db);
  const { round, message } = feedback.submit({
    capture,
    intent: "Fix this overflow",
    purpose: "bug",
    masks: [{ text: "dana@acme.example" }],
  });
  expect(round).toMatchObject({
    iteration: 1,
    purpose: "bug",
    acknowledgedPlan: null,
    verdict: null,
  });
  expect(round.capture.url).toBe("http://127.0.0.1:5173/invite");
  expect(round.capture.styles).toEqual({
    color: "rgb(255,255,255)",
    "background-color": "rgb(99,26,134)",
    overflow: "visible",
  });
  expect(round.capture.rect).toEqual({ x: 900, y: 40, width: 400, height: 36 });
  expect(
    JSON.stringify(db.prepare("SELECT * FROM element_feedback").all()),
  ).not.toMatch(/dana@acme|abc123|alert\(1\)/);
  expect(message).toContain("Bug report on one element");
  expect(message).toContain("Wanted: Fix this overflow");
  expect(message).toContain("Element: Send invite (button)");
  expect(message).toContain(
    "36 at 900,40, top right of a 1200×800 view, extending past the visible area",
  );
  expect(message).toContain("Visible text: Send invite to [hidden]");
  expect(message).toContain("- POST /api/invites 500");
  expect(message).toContain("- Contrast 3.1:1 is below 4.5:1");
  expect(message).toContain("Screenshot: captures/invite-1.png");
  expect(message).toContain("Before changing anything, name this element");
  db.close();
});

it("withholds the screenshot and text when a masked area overlaps the element", () => {
  const db = open();
  const { round, message } = new ElementFeedback(db).submit({
    capture,
    intent: "Make this more prominent",
    purpose: "design",
    masks: [
      { rect: { x: 1000, y: 30, width: 100, height: 100 } },
      { rect: { x: 0, y: 700, width: 10, height: 10 } },
    ],
  });
  expect(round.capture.screenshotRef).toBeUndefined();
  expect(round.capture.text).toBe("[hidden]");
  expect(message).toContain("Design feedback on one element");
  expect(message).toContain("2 area was masked");
  expect(message).not.toContain("Screenshot:");
  db.close();
});

it("refuses unusable captures and unsafe screenshot references", () => {
  const db = open();
  const feedback = new ElementFeedback(db);
  expect(() =>
    feedback.submit({ capture: {}, intent: "x", purpose: "bug" }),
  ).toThrow(/Select an element/);
  expect(() =>
    feedback.submit({
      capture: { ...capture, rect: { x: 0, y: 0, width: 0, height: 5 } },
      intent: "x",
      purpose: "bug",
    }),
  ).toThrow(/not visible/);
  expect(() =>
    feedback.submit({ capture, intent: " ", purpose: "bug" }),
  ).toThrow(/what you want/);
  expect(() =>
    feedback.submit({ capture, intent: "x", purpose: "rant" as never }),
  ).toThrow();
  const { round } = feedback.submit({
    capture: {
      ...capture,
      screenshotRef: "data:image/png;base64,AAAA",
      url: "javascript:alert(1)",
    },
    intent: "x",
    purpose: "bug",
  });
  expect(round.capture.screenshotRef).toBeUndefined();
  expect(round.capture.url).toBe("");
  db.close();
});

it("requires the agent's plan before a change, compares before and after, and supports another iteration", () => {
  const db = open();
  const feedback = new ElementFeedback(db);
  const { round } = feedback.submit({
    capture,
    intent: "Fix this overflow",
    purpose: "bug",
    productId: undefined as never,
  });
  const fixed = {
    ...capture,
    rect: { x: 780, y: 40, width: 400, height: 36 },
    styles: { ...capture.styles, overflow: "hidden" },
    consoleErrors: [],
    networkFailures: ["POST /api/invites 500", "GET /api/me 401"],
  };
  expect(() => feedback.recordAfter(round.id, fixed)).toThrow(/has not said/);
  expect(() => feedback.acknowledge(round.id, "I will tidy the page")).toThrow(
    /name the selected element/,
  );
  expect(
    feedback.acknowledge(
      round.id,
      "I will move the Send invite button inside its container",
    ).acknowledgedPlan,
  ).toContain("Send invite");
  expect(() => feedback.decide(round.id, "accepted")).toThrow(/no change/);
  const diff = feedback.recordAfter(round.id, fixed);
  expect(diff.changes).toEqual([
    { field: "position", before: "900,40", after: "780,40" },
    { field: "overflow", before: "visible", after: "hidden" },
  ]);
  expect(diff.errorsFixed).toEqual([
    "TypeError: x is undefined at invite.js:10 for dana@acme.example",
  ]);
  expect(diff.errorsNew).toEqual(["GET /api/me 401"]);
  expect(() =>
    feedback.submit({
      capture: fixed,
      intent: "More",
      purpose: "bug",
      threadId: round.threadId,
    }),
  ).toThrow(/Review the last change/);
  feedback.decide(round.id, "iterate");
  const second = feedback.submit({
    capture: fixed,
    intent: "Also fix the 401",
    purpose: "bug",
    threadId: round.threadId,
  });
  expect(second.round).toMatchObject({
    iteration: 2,
    threadId: round.threadId,
  });
  expect(
    feedback.thread(round.threadId).map((r) => [r.iteration, r.verdict]),
  ).toEqual([
    [1, "iterate"],
    [2, null],
  ]);
  expect(() =>
    feedback.submit({
      capture,
      intent: "x",
      purpose: "bug",
      threadId: "missing",
    }),
  ).toThrow(/Unknown feedback thread/);
  db.close();
});
