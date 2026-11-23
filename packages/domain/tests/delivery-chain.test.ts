import { describe, expect, it } from "vitest";
import {
  canProposeDelivered,
  progressOf,
  releaseReadiness,
  storyGroup,
} from "../src/work/delivery-chain.ts";
import { sprintRow } from "../src/work/planning.ts";

const story = (id: string, status: string) => ({ id, status });

describe("the delivery chain (Idea to Done, 23 November 2026)", () => {
  it("groups a tool's own status names under the four words", () => {
    expect(storyGroup("Done")).toBe("done");
    expect(storyGroup("Closed")).toBe("done");
    expect(storyGroup("In Progress")).toBe("in_progress");
    expect(storyGroup("in_review")).toBe("in_review");
    expect(storyGroup("Removed")).toBe("removed");
    expect(storyGroup("Ready for rehearsal")).toBe("todo");
    expect(storyGroup(null)).toBe("todo");
  });

  it("counts an epic's progress and ignores removed stories", () => {
    expect(progressOf([story("a", "Done"), story("b", "To do")])).toEqual({
      done: 1,
      total: 2,
      state: "in_progress",
    });
    expect(progressOf([story("a", "Done"), story("b", "Removed")]).state).toBe(
      "done",
    );
    expect(progressOf([]).state).toBe("not_started");
  });

  it("is ready to release only when every shipped story is done", () => {
    expect(
      releaseReadiness([story("a", "Done"), story("b", "In progress")]),
    ).toEqual({ ready: false, notDone: ["b"] });
    expect(releaseReadiness([story("a", "Done")]).ready).toBe(true);
    expect(releaseReadiness([]).ready).toBe(false);
  });

  it("proposes Delivered only with every kept epic done and the release live", () => {
    const epics = [
      { id: "e1", deferred: false, stories: [story("a", "Done")] },
      { id: "e2", deferred: true, stories: [story("b", "To do")] },
    ];
    expect(canProposeDelivered(epics, true)).toBe(true);
    expect(canProposeDelivered(epics, false)).toBe(false);
    expect(
      canProposeDelivered(
        [{ id: "e1", deferred: false, stories: [story("a", "In review")] }],
        true,
      ),
    ).toBe(false);
  });
});

describe("a sprint whose stories were never read", () => {
  it("says so instead of 0 / 0", () => {
    const sprint = {
      id: "ado:1",
      workAreaId: "a",
      workAreaName: "Gitex",
      name: "Sprint 6",
      team: "POCs Team",
      start: "",
      end: "",
      goal: "",
      draft: false,
      done: 0,
      total: 0,
      blocked: 0,
      changedInAdo: false,
    };
    expect(sprintRow({ ...sprint, unread: true }, 0).progress).toBe(
      "Open to count stories",
    );
    expect(sprintRow(sprint, 0).progress).toBe("0 / 0 stories done");
  });
});
