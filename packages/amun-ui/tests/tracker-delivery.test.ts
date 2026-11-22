import { describe, expect, it } from "vitest";
import type { TrackerDeliveryResult } from "@amun/contracts";
import {
  itemLabel,
  trackerEpics,
  trackerSprints,
} from "../src/rebuild/tracker-delivery.ts";

const base = {
  provider: "jira" as const,
  planId: "plan",
  type: "Task",
  acceptance: [],
  epicId: null,
  sprintId: null,
  status: null,
  start: null,
  end: null,
  outcome: "created" as const,
};
const delivery: TrackerDeliveryResult = {
  version: 1,
  kind: "tracker-delivery-result",
  workAreaId: "area",
  readAt: "2026-11-22T17:00:00.000Z",
  unread: [],
  items: [
    {
      ...base,
      itemId: "e1",
      kind: "epic",
      type: "Epic",
      title: "Attendee list",
      key: "SCRUM-13",
      url: "https://x/SCRUM-13",
    },
    {
      ...base,
      itemId: "s1",
      kind: "sprint",
      type: "Sprint",
      title: "Badge Desk Sprint 1",
      key: "6",
      url: "https://x/boards/1",
      status: "future",
      start: "2026-12-07",
      end: "2026-12-18",
    },
    {
      ...base,
      itemId: "t1",
      kind: "story",
      title: "Import attendees",
      key: "SCRUM-17",
      url: "https://x/SCRUM-17",
      epicId: "e1",
      sprintId: "s1",
      status: "To Do",
    },
    {
      ...base,
      itemId: "t2",
      kind: "story",
      title: "Badge types",
      key: "SCRUM-18",
      url: "https://x/SCRUM-18",
      epicId: "e1",
      sprintId: "s1",
      status: "Done",
    },
    {
      ...base,
      itemId: "t3",
      kind: "story",
      title: "Loose task",
      key: "SCRUM-30",
      url: null,
    },
    {
      ...base,
      itemId: "t4",
      kind: "story",
      title: "Never made",
      key: null,
      url: null,
      epicId: "e1",
      outcome: "failed",
    },
  ],
};

describe("Jira and Linear on Amun's screens", () => {
  it("makes each Jira sprint a Sprints entry with its stories by status", () => {
    const [sprint] = trackerSprints(delivery, "Badge Desk");
    expect(sprint).toMatchObject({
      id: "jira:6",
      workAreaId: "area",
      workAreaName: "Badge Desk",
      name: "Badge Desk Sprint 1",
      team: "Jira · future",
      start: "2026-12-07T00:00:00.000Z",
      end: "2026-12-18T23:59:59.999Z",
      done: 1,
      total: 2,
    });
    expect(sprint!.stories.map((s) => [s.title, s.state, s.storyUrl])).toEqual([
      ["SCRUM-17 Import attendees", "To Do", "https://x/SCRUM-17"],
      ["SCRUM-18 Badge types", "Done", "https://x/SCRUM-18"],
    ]);
  });

  it("groups stories under their epics for the Stories tab, and counts failures apart", () => {
    const { grouped, loose, failed } = trackerEpics(delivery);
    expect(
      grouped.map((g) => [itemLabel(g.epic), g.stories.map((s) => s.key)]),
    ).toEqual([["SCRUM-13 Attendee list", ["SCRUM-17", "SCRUM-18"]]]);
    expect(loose.map((s) => s.key)).toEqual(["SCRUM-30"]);
    expect(failed.map((s) => s.title)).toEqual(["Never made"]);
  });
});

describe("Linear cycles and existing sprints, known only through membership", () => {
  it("become Sprints entries with their stories", () => {
    const sprints = trackerSprints(
      {
        ...delivery,
        items: [
          {
            ...base,
            provider: "linear",
            itemId: "lin:i1",
            kind: "story",
            title: "Bill a client",
            key: "TRA-12",
            url: "https://linear.app/x/TRA-12",
            sprintId: "linear:cycle:TRA:4",
            status: "Todo",
          },
        ],
      },
      "Invoiced",
    );
    expect(sprints.map((s) => [s.id, s.name, s.team, s.total])).toEqual([
      ["linear:TRA:4", "TRA · Cycle 4", "Linear", 1],
    ]);
    expect(sprints[0]!.stories[0]!.title).toBe("TRA-12 Bill a client");
  });
});

describe("memberships come only from confirmed stories (Codex review on #63)", () => {
  it("keeps two teams' cycle 4 apart and ignores a story that was not created", () => {
    const story = {
      ...base,
      provider: "linear" as const,
      kind: "story" as const,
      url: null,
    };
    const sprints = trackerSprints(
      {
        ...delivery,
        items: [
          {
            ...story,
            itemId: "p:1",
            title: "TRA work",
            key: "TRA-1",
            sprintId: "linear:cycle:TRA:4",
          },
          {
            ...story,
            itemId: "p:2",
            title: "OPS work",
            key: "OPS-1",
            sprintId: "linear:cycle:OPS:4",
          },
          {
            ...story,
            itemId: "p:3",
            title: "Failed",
            key: null,
            sprintId: "linear:cycle:ENG:4",
            outcome: "failed" as const,
          },
          {
            ...story,
            itemId: "p:4",
            title: "Failed too",
            key: null,
            sprintId: "linear:cycle:TRA:4",
            outcome: "unknown" as const,
          },
        ],
      },
      "Invoiced",
    );
    expect(sprints.map((s) => [s.id, s.total])).toEqual([
      ["linear:TRA:4", 1],
      ["linear:OPS:4", 1],
    ]);
  });
});
