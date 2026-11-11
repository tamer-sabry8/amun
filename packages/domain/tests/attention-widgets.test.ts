import { it, expect } from "vitest";
import type { AttentionItem } from "../../contracts/src/entities.ts";
import { WidgetRegistry, dismissAction } from "../src/widgets.ts";
import {
  attentionKindKey,
  openAction,
  proposeAttention,
  registerAttentionKinds,
} from "../src/attention-widgets.ts";

const make = (
  id: string,
  type: AttentionItem["type"],
  changes: Partial<AttentionItem> = {},
): AttentionItem => ({
  id,
  productId: "p",
  type,
  origin: { kind: "firstmate", label: "Engineer", firstmateRef: null },
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

it("shows requests in the island with unblock first and next steps last", () => {
  const registry = new WidgetRegistry();
  registerAttentionKinds(registry);
  for (const [id, type] of [
    ["next", "go_to"],
    ["review", "review"],
    ["approve", "approve"],
    ["unblock", "unblock"],
  ] as const)
    expect(proposeAttention(registry, make(id, type)).ok).toBe(true);
  const island = registry.list({ slot: "island", productId: "p" });
  expect(island.map((widget) => widget.id)).toEqual([
    "unblock",
    "approve",
    "review",
    "next",
  ]);
  expect(island[0]?.title).toBe("Unblock · Engineer");
});

it("opens a request as an intent and never offers dismissal", () => {
  const registry = new WidgetRegistry();
  registerAttentionKinds(registry);
  const item = make("a", "approve", { governed: true });
  proposeAttention(registry, item);
  expect(registry.actions("a").map((action) => action.id)).toEqual([
    openAction,
  ]);
  expect(registry.act("a", dismissAction).ok).toBe(false);
  expect(registry.act("a", openAction)).toEqual({
    ok: true,
    intent: {
      widgetId: "a",
      kind: attentionKindKey("approve"),
      productId: "p",
      action: openAction,
      data: item,
    },
  });
  expect(registry.get("a")?.state).toBe("open");
});

it("refuses malformed requests and a request proposed under the wrong kind", () => {
  const registry = new WidgetRegistry();
  const dispose = registerAttentionKinds(registry);
  expect(
    registry.propose({
      id: "x",
      kind: attentionKindKey("decide"),
      productId: "p",
      data: make("x", "review"),
    }),
  ).toEqual({ ok: false, reason: "invalid_data" });
  expect(
    registry.propose({
      id: "y",
      kind: attentionKindKey("decide"),
      productId: "p",
      data: { ...make("y", "decide"), extra: true },
    }),
  ).toEqual({ ok: false, reason: "invalid_data" });
  dispose();
  expect(proposeAttention(registry, make("z", "decide"))).toEqual({
    ok: false,
    reason: "unknown_kind",
  });
});
