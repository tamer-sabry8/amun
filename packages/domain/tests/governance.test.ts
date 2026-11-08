import { expect, it } from "vitest";
import {
  canonicalJson,
  bindAction,
  transition,
  mutateAction,
  approveAction,
  canExecute,
  actionStates,
  actionKinds,
} from "../src/governance.ts";
const payload = { title: "Test", items: [{ id: "1", points: 3 }] };
const revisions = { repository: "head-1", workItem: 4 };
it("canonicalizes every object order recursively while preserving array order and types", () => {
  for (let i = 0; i < 100; i++) {
    const pairs = Array.from(
      { length: 15 },
      (_, n) => ["k" + n, { z: n, a: "value" }] as const,
    );
    const ordered = Object.fromEntries(pairs);
    const shuffled = Object.fromEntries(
      [...pairs].sort(
        (a, b) =>
          Math.sin(i + a[0].length + a[1].z) -
          Math.sin(i + b[0].length + b[1].z),
      ),
    );
    expect(canonicalJson(ordered)).toBe(canonicalJson(shuffled));
  }
  expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  expect(canonicalJson({ x: 1 })).not.toBe(canonicalJson({ x: "1" }));
});
it("rejects non-JSON, excessive and ambiguous inputs without invoking accessors", () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  let called = false;
  const accessor = Object.defineProperty({}, "secret", {
    enumerable: true,
    get() {
      called = true;
      return "secret";
    },
  });
  for (const value of [
    undefined,
    NaN,
    Infinity,
    1n,
    () => {},
    Symbol(),
    new Date(),
    cycle,
    accessor,
    [, 1],
    { x: undefined },
    "x".repeat(1_000_001),
  ])
    expect(() => canonicalJson(value)).toThrow();
  expect(called).toBe(false);
  let deep: unknown = 0;
  for (let i = 0; i < 65; i++) deep = { deep };
  expect(() => canonicalJson(deep)).toThrow();
});
it("binds each approval kind, complete payload and target revisions distinctly", () => {
  const hashes = actionKinds.map((kind) =>
    bindAction(kind, payload, revisions),
  );
  expect(new Set(hashes).size).toBe(actionKinds.length);
  expect(bindAction("publish", payload, revisions)).not.toBe(
    bindAction("publish", payload, { ...revisions, workItem: 5 }),
  );
  expect(bindAction("publish", payload, revisions)).not.toBe(
    bindAction("publish", { ...payload, title: "Changed" }, revisions),
  );
  expect(() => bindAction("unknown" as never, payload, revisions)).toThrow();
});
const edges: Record<string, string[]> = {
  proposed: ["pending_approval"],
  pending_approval: ["approved", "rejected", "expired"],
  approved: ["invalidated", "executing"],
  executing: ["succeeded", "failed", "unknown"],
  unknown: ["succeeded", "failed", "needs_review"],
  invalidated: ["pending_approval"],
  needs_review: [],
  expired: [],
  succeeded: [],
  failed: [],
  rejected: [],
};
it("accepts only specified state transitions, exhaustively", () => {
  for (const from of actionStates)
    for (const to of actionStates) {
      if (edges[from]?.includes(to)) expect(transition(from, to)).toBe(to);
      else expect(() => transition(from, to)).toThrow();
    }
  expect(() => transition("invented" as never, "approved")).toThrow();
});
it("requires fresh approval after every meaningful payload or revision mutation", () => {
  const pending = {
    id: "a",
    kind: "publish" as const,
    payload,
    revisions,
    state: "pending_approval" as const,
  };
  const approved = approveAction(pending, "pm", "2026-11-06T00:00:00Z");
  expect(canExecute(approved.action, approved.approval)).toBe(true);
  for (const changed of [
    mutateAction(approved.action, { ...payload, title: "Changed" }, revisions),
    mutateAction(approved.action, payload, { ...revisions, workItem: 5 }),
  ]) {
    expect(changed.state).toBe("invalidated");
    expect(canExecute(changed, approved.approval)).toBe(false);
  }
  expect(mutateAction(approved.action, payload, revisions).state).toBe(
    "approved",
  );
  expect(
    canExecute({ ...approved.action, id: "other" }, approved.approval),
  ).toBe(false);
  expect(
    canExecute({ ...approved.action, kind: "merge" }, approved.approval),
  ).toBe(false);
  expect(() => approveAction(approved.action, "pm", "now")).toThrow();
  expect(() =>
    mutateAction(
      { ...approved.action, state: "executing" },
      payload,
      revisions,
    ),
  ).toThrow();
  expect(() => approveAction(pending, "", "now")).toThrow();
});
