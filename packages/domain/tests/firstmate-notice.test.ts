import { describe, expect, it } from "vitest";
import { workCommand } from "../../contracts/src/work.ts";
import {
  firstmateNotice,
  isNoted,
  noticePrompt,
  noticeRules,
} from "../src/work/firstmate-notice.ts";

const actions = workCommand.options.map(
  (option) => option.shape.action.value as string,
);

describe("what Amun tells Firstmate about the owner's actions", () => {
  it("decides for every work command, with a reason when Firstmate is not told", () => {
    expect(Object.keys(noticeRules).sort()).toEqual([...actions].sort());
    for (const action of actions) {
      const rule = noticeRules[action as keyof typeof noticeRules];
      if ("tell" in rule) expect(typeof rule.tell).toBe("function");
      else
        expect(
          ("own" in rule ? rule.own : rule.local).length,
          action,
        ).toBeGreaterThan(10);
    }
  });

  it("tells Firstmate about work on cards, and never about moving around", () => {
    const told = actions.filter(
      (action) => "tell" in noticeRules[action as keyof typeof noticeRules],
    );
    for (const action of [
      "move-rfp",
      "save-rfp",
      "handoff-rfp",
      "update-area",
      "delete-area",
      "reminder",
      "finish-reminder",
      "snooze-reminder",
      "resolve-attention",
      "approve-plan",
      "approve-output",
      "save-roadmap-item",
      "save-sprint",
      "resolve-blocker",
    ])
      expect(told, action).toContain(action);
    for (const action of ["snapshot", "seen", "touch-area", "message"])
      expect(told, action).not.toContain(action);
  });

  it("says what was done and carries the whole card", () => {
    const area = {
      id: "a1",
      name: "Smart parking analytics",
      type: "rfp",
      groupId: "g1",
    };
    const rfp = {
      id: "a1",
      client: "DMT",
      stage: "lost",
      deadline: "2026-12-14T00:00:00.000Z",
      lossReason: "Price",
    };
    const notice = firstmateNotice(
      workCommand.parse({
        version: 1,
        kind: "work",
        action: "move-rfp",
        areaId: "a1",
        stage: "lost",
        lossReason: "Price",
      }),
      {
        before: null,
        after: { areas: [area], rfps: [rfp] } as never,
        ref: null,
      },
    );
    expect(notice?.what).toBe(
      "moved the RFP “Smart parking analytics” to lost, reason: “Price”",
    );
    expect(notice?.workAreaId).toBe("a1");
    expect(notice?.card).toEqual([
      { list: "areas", ...area },
      { list: "rfps", ...rfp },
    ]);
    const prompt = noticePrompt([notice!]);
    expect(prompt).toContain("not typed by the captain");
    expect(prompt).toContain('"client": "DMT"');
    expect(prompt).toContain("reply with exactly: Noted.");
  });

  it("uses the record from before the change for something deleted", () => {
    const notice = firstmateNotice(
      workCommand.parse({
        version: 1,
        kind: "work",
        action: "delete-area",
        areaId: "a1",
      }),
      {
        before: { areas: [{ id: "a1", name: "Gitex" }] } as never,
        after: { areas: [] } as never,
        ref: null,
      },
    );
    expect(notice?.what).toBe("deleted “Gitex”");
    expect(notice?.card).toEqual([{ list: "areas", id: "a1", name: "Gitex" }]);
  });

  it("leaves Firstmate's own holds, its own drafts and move questions to their own paths", () => {
    const at = {
      before: {
        attention: [{ id: "q1", title: "Where?", ref: "move:m1" }],
      } as never,
      after: null,
      ref: null,
    };
    const resolve = (attentionId: string) =>
      firstmateNotice(
        workCommand.parse({
          version: 1,
          kind: "work",
          action: "resolve-attention",
          attentionId,
          resolution: "done",
        }),
        at,
      );
    expect(resolve("hold:moca")).toBeNull();
    expect(resolve("q1")).toBeNull();
    expect(
      firstmateNotice(
        workCommand.parse({
          version: 1,
          kind: "work",
          action: "save-output",
          groupId: null,
          type: "prd",
          title: "PRD",
          author: "firstmate",
        }),
        at,
      ),
    ).toBeNull();
  });

  it("puts several actions in one prompt, in order", () => {
    const prompt = noticePrompt([
      { what: "did one thing", card: [], workAreaId: null },
      { what: "did another", card: [], workAreaId: null },
    ]);
    expect(prompt).toContain("1. The captain did one thing.");
    expect(prompt).toContain("2. The captain did another.");
  });

  it("knows a bare acknowledgement from something worth showing", () => {
    for (const reply of ["Noted.", "noted", "Captain, noted.", "", "Aye aye."])
      expect(isNoted(reply), reply).toBe(true);
    expect(isNoted("Noted. The Solution Architect is on it.")).toBe(false);
  });
});
