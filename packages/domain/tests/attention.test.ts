import { it, expect } from "vitest";
import type { AttentionItem } from "../../contracts/src/entities.ts";
import {
  attentionQueue,
  resolveAttention,
  snoozeAttention,
  activitySummary,
} from "../src/attention.ts";
const make = (
  id: string,
  type: AttentionItem["type"],
  changes: Partial<AttentionItem> = {},
): AttentionItem => ({
  id,
  productId: "p",
  type,
  origin: { kind: "firstmate", label: "Firstmate", firstmateRef: null },
  ask: "Needs attention",
  detail: "Details",
  blocking: [],
  primaryAction: {
    label: "Review",
    mode: "navigate",
    intent: "open_request",
    targetRef: id,
  },
  governed: false,
  state: "open",
  snoozedUntil: null,
  createdAt: "2026-11-06T00:00:00Z",
  ...changes,
});
it("uses one product-scoped ordered query with expiry and stable oldest-first ties", () => {
  const items = [
    make("review", "review"),
    make("answer", "answer", { blocking: ["running"] }),
    make("approve", "approve", { governed: true }),
    make("unblock", "unblock"),
    make("later", "go_to"),
    make("other", "unblock", { productId: "other" }),
    make("resolved", "unblock", { state: "resolved" }),
    make("snoozed", "unblock", {
      state: "snoozed",
      snoozedUntil: "2026-11-07T00:00:00Z",
    }),
  ];
  expect(
    attentionQueue(
      items,
      "p",
      Date.parse("2026-11-06T12:00:00Z"),
      new Set(["running"]),
    ).map((i) => i.id),
  ).toEqual(["unblock", "answer", "approve", "review", "later"]);
  expect(
    attentionQueue(
      items,
      "p",
      Date.parse("2026-11-08T00:00:00Z"),
      new Set(["running"]),
    ).some((i) => i.id === "snoozed"),
  ).toBe(true);
  expect(items[0]?.state).toBe("open");
});
it("never resolves governed or navigation items from the Island and permits only explicit non-governed inline answers", () => {
  const governed = make("a", "approve", { governed: true });
  expect(() => resolveAttention(governed, "island", "yes")).toThrow();
  const navigation = make("r", "review");
  expect(() => resolveAttention(navigation, "island", "yes")).toThrow();
  const answer = make("q", "answer", {
    primaryAction: {
      label: "Answer",
      mode: "inline",
      intent: "answer",
      targetRef: "q",
    },
  });
  expect(() => resolveAttention(answer, "island", "")).toThrow();
  expect(() => resolveAttention(answer, "review")).toThrow();
  expect(resolveAttention(answer, "island", "A considered answer").state).toBe(
    "resolved",
  );
  expect(answer.state).toBe("open");
  expect(resolveAttention(navigation, "review").state).toBe("resolved");
  expect(() => resolveAttention(governed, "review")).toThrow();
});
it("snoozes explicitly, refuses invalid times and preserves the request in history", () => {
  const item = make("r", "review");
  const now = Date.parse("2026-11-06T00:00:00Z");
  expect(snoozeAttention(item, now + 60000, now).state).toBe("snoozed");
  for (const time of [now - 1, NaN, Infinity])
    expect(() => snoozeAttention(item, time, now)).toThrow();
  expect(() =>
    snoozeAttention({ ...item, state: "resolved" }, now + 60000, now),
  ).toThrow();
});
it("keeps progress out of the attention queue and derives status counts/colour independently", () => {
  expect(activitySummary([])).toEqual({
    working: 0,
    publishing: 0,
    waiting: 0,
    failed: 0,
    tone: "idle",
  });
  expect(
    activitySummary([
      { kind: "run", state: "working" },
      { kind: "publication", state: "working" },
      { kind: "sync", state: "waiting" },
    ]),
  ).toEqual({
    working: 1,
    publishing: 1,
    waiting: 1,
    failed: 0,
    tone: "waiting",
  });
  expect(activitySummary([{ kind: "run", state: "failed" }]).tone).toBe(
    "failed",
  );
});
