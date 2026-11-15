import { describe, expect, it } from "vitest";
import {
  blockerLine,
  blockerUpdateLines,
  findBlocker,
  openBlockers,
  raisedAgo,
  type Blocker,
} from "../src/work/blockers.ts";

const now = Date.parse("2026-11-15T12:00:00Z");
const make = (id: string, extra: Partial<Blocker> = {}): Blocker => ({
  id,
  workAreaId: "a",
  title: id,
  owner: null,
  raisedAt: "2026-11-12T12:00:00Z",
  resolvedAt: null,
  ...extra,
});

describe("blocker owner and age", () => {
  it("says how long ago a blocker was raised", () => {
    expect(raisedAgo("2026-11-15T01:00:00Z", now)).toBe("raised today");
    expect(raisedAgo("2026-11-14T11:00:00Z", now)).toBe("raised yesterday");
    expect(raisedAgo("2026-11-12T12:00:00Z", now)).toBe("raised 3 days ago");
    // A clock that is behind never gives a negative age.
    expect(raisedAgo("2026-11-16T12:00:00Z", now)).toBe("raised today");
  });
  it("shows the owner, or says there is none", () => {
    expect(blockerLine(make("x", { owner: " Priya " }), now)).toBe(
      "Priya · raised 3 days ago",
    );
    expect(blockerLine(make("x"), now)).toBe(
      "No owner yet · raised 3 days ago",
    );
  });
  it("lists only open blockers, oldest first, for one work area", () => {
    const list = [
      make("late", { raisedAt: "2026-11-14T00:00:00Z" }),
      make("early"),
      make("done", { resolvedAt: "2026-11-14T00:00:00Z" }),
      make("other", { workAreaId: "b" }),
    ];
    expect(openBlockers(list, "a").map((item) => item.id)).toEqual([
      "early",
      "late",
    ]);
  });
  it("finds the blocker a message names, never a vague match", () => {
    const list = [
      make("b1", { title: "Legal review" }),
      make("b2", { title: "Legal sign-off" }),
      make("b3", { title: "API key" }),
    ];
    expect(findBlocker(list, "legal review")?.id).toBe("b1");
    expect(findBlocker(list, "api")?.id).toBe("b3");
    expect(findBlocker(list, "legal")).toBeNull();
    expect(findBlocker(list, "")).toBeNull();
  });
  it("puts owner and age on each line of an update", () => {
    expect(
      blockerUpdateLines(
        [make("b", { title: "API key", owner: "Priya" })],
        now,
      ),
    ).toEqual(["Blocked: API key (Priya · raised 3 days ago)"]);
  });
});
