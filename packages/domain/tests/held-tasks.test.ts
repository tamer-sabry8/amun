import { describe, expect, it } from "vitest";
import {
  heldInstruction,
  heldOutcome,
  heldProject,
  helpRequest,
  isHeld,
  laterDays,
} from "../src/work/held-tasks.ts";

const areas = [
  { name: "MoCA Ecabinet", type: "product", status: "active" },
  { name: "Gitex", type: "project", status: "active" },
  { name: "Chat with Firstmate", type: "task", status: "active" },
  { name: "Old", type: "project", status: "deleted" },
];

describe("Firstmate's reminders on Home", () => {
  it("files a reminder under the project its title names", () => {
    expect(
      heldProject(
        "MoCA: decide who is in the pilot group (ministers and delegates)",
        areas,
      ),
    ).toBe("MoCA");
    expect(heldProject("Gitex - booth checklist", areas)).toBe("Gitex");
    expect(heldProject("gitex: travel", areas)).toBe("gitex");
  });

  it("leaves a reminder with no project as a reminder", () => {
    expect(
      heldProject(
        "Captain reminder: email about the AI Strategy for 2027",
        areas,
      ),
    ).toBeNull();
    expect(heldProject("Old: something", areas)).toBeNull();
    expect(heldProject("No prefix at all", areas)).toBeNull();
    expect(heldProject("Chat with Firstmate: x", areas)).toBeNull();
  });

  it("knows Firstmate's holds from Amun's own items", () => {
    expect(isHeld("hold:moca-pilot-group")).toBe(true);
    expect(isHeld("a1")).toBe(false);
  });

  it("offers later days on the owner's calendar, never today", () => {
    // Friday 20 November 2026.
    expect(laterDays(new Date(2026, 10, 20, 15))).toEqual([
      { label: "Tomorrow morning", day: "2026-11-21" },
      { label: "Next Monday", day: "2026-11-23" },
      { label: "In two weeks", day: "2026-12-04" },
    ]);
    // On a Monday, next Monday is a week on.
    expect(laterDays(new Date(2026, 10, 23, 9))[1]!.day).toBe("2026-11-30");
  });

  it("tells Firstmate what to do in plain words", () => {
    expect(heldOutcome("done")).toBe("Completed");
    expect(heldOutcome("snooze", "2026-11-23")).toBe("Remind me on 2026-11-23");
    expect(heldInstruction("done")).toMatch(/close the task/);
    expect(heldInstruction("snooze", "2026-11-23")).toMatch(
      /--until 2026-11-23/,
    );
    expect(helpRequest("Email about AI Strategy")).toMatch(
      /^Help me do it: Email about AI Strategy\n.*interview me one question at a time/s,
    );
  });
});
