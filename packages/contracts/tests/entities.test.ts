import { describe, expect, it } from "vitest";
import {
  attentionItem,
  notification,
  statusActivity,
  action,
  approval,
  run,
} from "../src/entities.js";

const at = "2026-11-05T10:12:00Z";
const attention = {
  id: "att-1",
  productId: "product-1",
  type: "answer",
  origin: { kind: "firstmate", label: "Firstmate", firstmateRef: null },
  ask: "Which segment?",
  detail: "",
  blocking: [],
  primaryAction: {
    label: "Answer",
    mode: "inline",
    intent: "answer",
    targetRef: "request-1",
  },
  governed: false,
  state: "open",
  snoozedUntil: null,
  createdAt: at,
};
const operation = {
  id: "act-1",
  productId: "product-1",
  kind: "publish",
  payload: { title: "Story" },
  payloadHash: "a".repeat(64),
  targetRevisions: { "item-1": "3" },
  state: "unknown",
  requestedBy: "firstmate",
  operationMarker: "marker-1",
};
const fixtures = [
  [attentionItem, attention],
  [
    notification,
    {
      id: "note-1",
      productId: "product-1",
      kind: "run_completed",
      text: "Finished",
      ref: "run-1",
      readAt: null,
      createdAt: at,
    },
  ],
  [
    statusActivity,
    {
      id: "activity-1",
      productId: "product-1",
      kind: "reconciliation",
      state: "waiting",
      ref: "act-1",
      text: "Checking result",
    },
  ],
  [action, operation],
  [
    approval,
    {
      id: "approval-1",
      subject: { kind: "action", id: "act-1" },
      decision: "approved",
      payloadHash: "a".repeat(64),
      targetRevisions: { "item-1": "3" },
      approvedBy: "pm-1",
      approvedAt: at,
      invalidatedReason: null,
    },
  ],
  [
    run,
    {
      id: "run-1",
      productId: "product-1",
      storyId: "AM-1",
      agentRole: "Engineer",
      harness: "codex",
      model: "model-1",
      firstmateTaskId: "task-1",
      backend: "herdr",
      paneRef: "pane-1",
      worktree: "/workspace/task-1",
      branch: "feat/task-1",
      state: "unknown",
      startedAt: at,
    },
  ],
] as const;

describe("shared entity boundaries", () => {
  it.each(fixtures)("round-trips valid data %#", (schema, value) => {
    expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
  });
  it.each(fixtures)(
    "rejects undeclared fields and malformed identifiers %#",
    (schema, value) => {
      expect(schema.safeParse({ ...value, secret: "canary" }).success).toBe(
        false,
      );
      expect(schema.safeParse({ ...value, id: "" }).success).toBe(false);
      expect(schema.safeParse(null).success).toBe(false);
    },
  );
  it.each([
    { ...attention, governed: true },
    { ...attention, type: "approve" },
    { ...attention, type: "decide" },
    { ...attention, state: "snoozed" },
    { ...attention, createdAt: "yesterday" },
    {
      ...attention,
      primaryAction: { ...attention.primaryAction, mode: "execute" },
    },
  ])("refuses unsafe or inconsistent attention payloads %#", (value) => {
    expect(attentionItem.safeParse(value).success).toBe(false);
  });
  it("accepts governed navigation and a timestamped snooze", () => {
    expect(
      attentionItem.safeParse({
        ...attention,
        type: "approve",
        governed: true,
        state: "snoozed",
        snoozedUntil: at,
        primaryAction: {
          ...attention.primaryAction,
          mode: "navigate",
          intent: "open_request",
        },
      }).success,
    ).toBe(true);
  });
  it("does not silently promote uncertain action or run states to success", () => {
    expect(action.parse(operation).state).toBe("unknown");
    expect(action.safeParse({ ...operation, state: "done" }).success).toBe(
      false,
    );
    expect(
      run.safeParse({ ...fixtures[5][1], state: "accepted" }).success,
    ).toBe(false);
  });
  it("rejects broken approval bindings and non-JSON payloads", () => {
    expect(
      action.safeParse({ ...operation, payloadHash: "short" }).success,
    ).toBe(false);
    expect(
      action.safeParse({ ...operation, payload: { execute: () => true } })
        .success,
    ).toBe(false);
    expect(
      approval.safeParse({
        ...fixtures[4][1],
        subject: { kind: "action", id: "" },
      }).success,
    ).toBe(false);
  });
});
