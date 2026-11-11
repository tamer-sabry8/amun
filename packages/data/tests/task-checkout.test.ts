import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { TaskCheckout, defaultLeaseMs } from "../src/task-checkout.ts";

const setup = () => {
  const db = new Database(":memory:");
  migrate(db);
  let now = Date.parse("2026-11-10T10:00:00Z");
  const checkout = new TaskCheckout(db, () => new Date(now));
  return { db, checkout, advance: (ms: number) => (now += ms) };
};
const task = { kind: "work_item", id: "AM-104" };
const eng = { kind: "agent", id: "engineer" } as const;
const qa = { kind: "agent", id: "qa" } as const;

it("gives one holder the claim and refuses a competing execution", () => {
  const { db, checkout } = setup();
  expect(checkout.status(task)).toMatchObject({
    state: "available",
    holder: null,
    generation: 0,
  });
  const first = checkout.checkout(task, eng, "Implementing invites");
  expect(first).toMatchObject({
    ok: true,
    claim: {
      state: "claimed",
      holder: eng,
      generation: 1,
      activity: "Implementing invites",
    },
  });
  const second = checkout.checkout(task, qa);
  expect(second).toMatchObject({
    ok: false,
    reason: "held_by_another",
    claim: { holder: eng },
  });
  expect(checkout.checkout(task, eng, "Still going")).toMatchObject({
    ok: true,
    claim: { generation: 1, activity: "Still going" },
  });
  expect(checkout.checkout({ kind: "work_item", id: "AM-105" }, qa).ok).toBe(
    true,
  );
  expect(checkout.held().map((c) => c.task.id)).toEqual(["AM-104", "AM-105"]);
  expect(() => checkout.checkout({ kind: "Bad Kind", id: "x" }, eng)).toThrow();
  expect(() =>
    checkout.checkout(task, { kind: "robot" as never, id: "x" }),
  ).toThrow();
  db.close();
});

it("moves between executing, waiting and finished states only for the holder", () => {
  const { db, checkout, advance } = setup();
  checkout.checkout(task, eng);
  expect(checkout.wait(task, qa, "human", "x")).toMatchObject({
    ok: false,
    reason: "not_holder",
  });
  expect(checkout.wait(task, eng, "human", "Needs a product decision").ok).toBe(
    true,
  );
  expect(checkout.status(task)).toMatchObject({
    state: "waiting_human",
    holder: eng,
    expiresAt: null,
  });
  advance(defaultLeaseMs * 10);
  expect(checkout.recover()).toEqual([]);
  expect(checkout.checkout(task, qa)).toMatchObject({
    ok: false,
    reason: "held_by_another",
  });
  expect(checkout.wait(task, eng, "dependency", "Waiting for AM-90").ok).toBe(
    true,
  );
  expect(checkout.status(task).state).toBe("waiting_dependency");
  expect(checkout.wait(task, eng, "nothing", "AM-90 landed").ok).toBe(true);
  expect(checkout.status(task)).toMatchObject({
    state: "claimed",
    stalled: false,
  });
  expect(checkout.status(task).expiresAt).not.toBeNull();
  expect(checkout.complete(task, eng, "PR merged").ok).toBe(true);
  expect(checkout.status(task)).toMatchObject({
    state: "completed",
    holder: null,
  });
  expect(checkout.checkout(task, qa)).toMatchObject({
    ok: false,
    reason: "completed",
  });
  expect(() => checkout.reclaim(task, "Tamer", "redo")).toThrow(/Completed/);
  db.close();
});

it("releases a failed task for another attempt and recovers a stalled claim deliberately", () => {
  const { db, checkout, advance } = setup();
  checkout.checkout(task, eng);
  checkout.fail(task, eng, "Tests could not run");
  expect(checkout.status(task)).toMatchObject({
    state: "failed",
    holder: null,
  });
  expect(checkout.checkout(task, qa)).toMatchObject({
    ok: true,
    claim: { holder: qa, generation: 3 },
  });
  advance(defaultLeaseMs - 1000);
  expect(checkout.renew(task, qa, "Halfway").ok).toBe(true);
  advance(defaultLeaseMs - 1000);
  expect(checkout.status(task).stalled).toBe(false);
  expect(checkout.recover()).toEqual([]);
  advance(2000);
  expect(checkout.status(task).stalled).toBe(true);
  expect(checkout.checkout(task, eng)).toMatchObject({
    ok: false,
    reason: "held_by_another",
  });
  expect(checkout.recover().map((c) => [c.task.id, c.state, c.holder])).toEqual(
    [["AM-104", "available", null]],
  );
  expect(checkout.renew(task, qa)).toMatchObject({
    ok: false,
    reason: "not_holder",
  });
  expect(checkout.checkout(task, eng).ok).toBe(true);
  db.close();
});

it("lets a named person transfer, pause, resume and reclaim, with a complete audit trail", () => {
  const { db, checkout, advance } = setup();
  checkout.checkout(task, eng, "Building");
  advance(60000);
  expect(checkout.status(task).heldForMs).toBe(60000);
  expect(() => checkout.transfer(task, qa, " ", "x")).toThrow(/who/);
  expect(() => checkout.transfer(task, qa, "Tamer", " ")).toThrow(/reason/);
  expect(
    checkout.transfer(task, qa, "Tamer", "Engineer is overloaded"),
  ).toMatchObject({ holder: qa, state: "claimed", heldForMs: 0 });
  expect(checkout.complete(task, eng).ok).toBe(false);
  expect(checkout.pause(task, "Tamer", "Scope under review")).toMatchObject({
    state: "paused",
    holder: qa,
  });
  expect(checkout.checkout(task, eng)).toMatchObject({
    ok: false,
    reason: "paused",
  });
  expect(checkout.renew(task, qa).ok).toBe(false);
  expect(checkout.resume(task, "Tamer", "Scope confirmed")).toMatchObject({
    state: "claimed",
    holder: qa,
  });
  expect(() => checkout.resume(task, "Tamer", "again")).toThrow(/not paused/);
  expect(
    checkout.reclaim(task, "Tamer", "Reassigning the sprint"),
  ).toMatchObject({ state: "available", holder: null });
  expect(() => checkout.transfer(task, eng, "Tamer", "x")).toThrow(/Nobody/);
  expect(
    checkout.history(task).map((e) => [e.actor, e.event, e.holder]),
  ).toEqual([
    ["agent:engineer", "claimed", "agent:engineer"],
    ["Tamer", "transferred", "agent:qa"],
    ["Tamer", "paused", "agent:qa"],
    ["Tamer", "resumed", "agent:qa"],
    ["Tamer", "reclaimed", "agent:qa"],
  ]);
  expect(() => db.prepare("DELETE FROM task_claim_events").run()).toThrow(
    /append-only/,
  );
  expect(() =>
    db.prepare("UPDATE task_claim_events SET actor='x'").run(),
  ).toThrow(/append-only/);
  db.close();
});

it("lets only one of two connections on the same database win the claim", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "amun-claims-"));
  try {
    const a = new Database(join(dir, "db.sqlite"));
    migrate(a);
    const b = new Database(join(dir, "db.sqlite"));
    const results = [
      new TaskCheckout(a).checkout(task, eng),
      new TaskCheckout(b).checkout(task, qa),
    ];
    expect(results.map((r) => r.ok)).toEqual([true, false]);
    expect(new TaskCheckout(b).status(task).holder).toEqual(eng);
    a.close();
    b.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
