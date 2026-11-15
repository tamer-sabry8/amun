import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { WorkStore } from "../src/work-store.ts";

let db: Database.Database;
let clock = new Date(2026, 10, 15, 14, 0, 0).getTime();
let store: WorkStore;
const open = () => new WorkStore(db, undefined, () => new Date(clock));
beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  clock = new Date(2026, 10, 15, 14, 0, 0).getTime();
  store = open();
});
type Result = { ok: boolean; message: string; step: { step?: string } | null };
const send = (action: string, extra: Record<string, unknown> = {}) =>
  store
    .handle({ version: 1, kind: "work", action, ...extra })
    .find(
      (event) => (event as { kind: string }).kind === "work-result",
    ) as Result;
const count = (table: string) =>
  db.prepare(`SELECT count(*) FROM ${table}`).pluck().get();

describe("reminders", () => {
  it("are kept from the composer without making any work", () => {
    const result = send("intake", {
      text: "Remind me in 2 minutes to review the QA PRD",
      groupId: null,
    });
    expect(result).toMatchObject({ ok: true, step: { step: "reminder" } });
    expect(result.message).toContain("review the QA PRD");
    expect(store.snapshot().reminders).toMatchObject([
      { text: "review the QA PRD", state: "scheduled", workAreaId: null },
    ]);
    expect(count("work_areas")).toBe(0);
    expect(count("work_records")).toBe(0);
  });

  it("asks for a time instead of creating anything", () => {
    const result = send("intake", {
      text: "remind me to call Sam",
      groupId: null,
    });
    expect(result.ok).toBe(false);
    expect(store.snapshot().reminders).toEqual([]);
  });

  it("come due, can be snoozed for 10 minutes and then finished", () => {
    send("reminder", {
      text: "remind me in 2 minutes to stretch",
      workAreaId: null,
    });
    expect(store.reminders.deliver(false)).toEqual([]);
    clock += 121_000;
    const [due] = store.reminders.deliver(false);
    expect(due).toMatchObject({ text: "stretch", missed: false });
    expect(store.reminders.deliver(false)).toEqual([]);
    const id = store.snapshot().reminders[0]!.id;
    expect(store.snapshot().reminders[0]).toMatchObject({ state: "due" });
    send("snooze-reminder", { reminderId: id });
    expect(store.snapshot().reminders[0]).toMatchObject({
      state: "scheduled",
      dueAt: new Date(clock + 600_000).toISOString(),
    });
    clock += 600_000;
    expect(store.reminders.deliver(false)).toHaveLength(1);
    send("finish-reminder", { reminderId: id });
    expect(store.snapshot().reminders).toEqual([]);
  });

  it("survive a restart and show when they were missed", () => {
    send("reminder", {
      text: "remind me in 2 minutes to stretch",
      workAreaId: null,
    });
    const dueAt = new Date(clock + 120_000).toISOString();
    clock += 3_600_000;
    const restarted = open();
    expect(restarted.reminders.deliver(true)).toMatchObject([
      { text: "stretch", missed: true, dueAt },
    ]);
    expect(restarted.snapshot().reminders[0]).toMatchObject({
      state: "due",
      missedAt: dueAt,
    });
    expect(restarted.reminders.deliver(true)).toEqual([]);
  });

  it("link to the work area they were asked in and are listed and cancelled by name", () => {
    const area = (
      store.handle({
        version: 1,
        kind: "work",
        action: "create-area",
        groupId: null,
        type: "task",
        name: "QA",
      })[0] as { ref: string }
    ).ref;
    send("reminder", {
      text: "remind me in 5 minutes to review the QA PRD",
      workAreaId: area,
    });
    send("reminder", {
      text: "remind me tomorrow to call Sam",
      workAreaId: null,
    });
    expect(store.snapshot().reminders.map((item) => item.workAreaId)).toEqual([
      area,
      null,
    ]);
    expect(
      send("reminder", { text: "what reminders do I have?", workAreaId: null })
        .message,
    ).toMatch(/review the QA PRD[\s\S]*call Sam/);
    expect(
      send("reminder", {
        text: "cancel the reminder about the QA PRD",
        workAreaId: null,
      }).message,
    ).toContain("Cancelled");
    expect(store.snapshot().reminders.map((item) => item.text)).toEqual([
      "call Sam",
    ]);
    expect(
      send("reminder", { text: "cancel all reminders", workAreaId: null })
        .message,
    ).toContain("Cancelled");
    expect(store.snapshot().reminders).toEqual([]);
  });
});
