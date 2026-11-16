import { describe, expect, it } from "vitest";
import {
  parseReminder,
  reminderIntent,
  reminderMatches,
} from "../src/work/reminders.ts";

const now = new Date(2026, 10, 15, 14, 0, 0); // Sunday

describe("reminderIntent", () => {
  it("tells add, list and cancel apart", () => {
    expect(reminderIntent("Remind me in 2 minutes to review the QA PRD")).toBe(
      "add",
    );
    expect(reminderIntent("what reminders do I have?")).toBe("list");
    expect(reminderIntent("cancel my reminder about the QA PRD")).toBe(
      "cancel",
    );
    expect(reminderIntent("review the QA PRD")).toBeNull();
  });
});

describe("parseReminder", () => {
  it("reads a duration and the words after it", () => {
    const parsed = parseReminder(
      "Remind me in 2 minutes to review the QA PRD.",
      now,
    );
    expect(parsed).toEqual({
      ok: true,
      dueAt: new Date(now.getTime() + 120_000),
      what: "review the QA PRD",
    });
  });
  it("reads words first, then the time", () => {
    const parsed = parseReminder("remind me to call Sam in half an hour", now);
    expect(parsed).toMatchObject({ ok: true, what: "call Sam" });
    expect(parsed.ok && parsed.dueAt.getTime()).toBe(now.getTime() + 1_800_000);
  });
  it("reads clock times, tomorrow and weekdays", () => {
    const at = (text: string) => {
      const parsed = parseReminder(text, now);
      if (!parsed.ok) throw Error(parsed.message);
      return parsed.dueAt;
    };
    expect(at("remind me at 5pm to send the deck")).toEqual(
      new Date(2026, 10, 15, 17, 0),
    );
    expect(at("remind me at 1pm to send the deck")).toEqual(
      new Date(2026, 10, 16, 13, 0),
    );
    expect(at("remind me tomorrow to call Sam")).toEqual(
      new Date(2026, 10, 16, 9, 0),
    );
    expect(at("remind me on Friday at 10:30 to ship")).toEqual(
      new Date(2026, 10, 20, 10, 30),
    );
  });
  it("asks for the time or the words instead of guessing", () => {
    expect(parseReminder("remind me to call Sam", now)).toMatchObject({
      ok: false,
      message: expect.stringContaining("when"),
    });
    expect(parseReminder("remind me in 5 minutes", now)).toMatchObject({
      ok: false,
      message: expect.stringContaining("about"),
    });
  });
});

describe("reminderMatches", () => {
  const open = [{ text: "review the QA PRD" }, { text: "call Sam" }];
  it("finds the reminder a request names", () => {
    expect(
      reminderMatches("cancel the reminder about the QA PRD", open),
    ).toEqual([open[0]]);
    expect(reminderMatches("cancel all reminders", open)).toEqual(open);
    expect(reminderMatches("cancel my reminder", open)).toEqual([]);
  });
});
