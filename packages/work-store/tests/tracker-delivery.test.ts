import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/sqlite.ts";
import { migrate } from "../src/database.ts";
import {
  deliveryRecords,
  readDelivery,
} from "../src/trackers/tracker-delivery.ts";

// The Badge Desk Jira plan from the 22 November 2026 run, trimmed: an epic,
// a sprint, two tasks under the epic (one in the sprint), one failed task.
const site = { site: "transfrmai.atlassian.net", project: "SCRUM" };
const items = [
  {
    id: "e1",
    summary: "Attendee list and badge data",
    fields: { ...site, type: "Epic" },
  },
  {
    id: "s1",
    summary: "Badge Desk Sprint 1",
    fields: {
      ...site,
      type: "Sprint",
      board: "1",
      start: "2026-12-07",
      end: "2026-12-18",
    },
  },
  {
    id: "t1",
    summary: "Import attendees from CSV",
    fields: {
      ...site,
      type: "Task",
      acceptance: "Given a CSV, columns map\nGiven bad rows, each is listed",
      parent: "Attendee list and badge data",
      sprint: "s1",
    },
  },
  {
    id: "t2",
    summary: "Define badge types",
    fields: { ...site, type: "Task", parent: "e1" },
  },
  {
    id: "t3",
    summary: "Never made",
    fields: { ...site, type: "Task", parent: "e1" },
  },
];
const results = [
  {
    id: "e1",
    state: "created",
    externalId: "SCRUM-13",
    url: "https://transfrmai.atlassian.net/browse/SCRUM-13",
  },
  {
    id: "s1",
    state: "created",
    externalId: "6",
    url: "https://transfrmai.atlassian.net/jira/software/projects/SCRUM/boards/1",
  },
  {
    id: "t1",
    state: "created",
    externalId: "SCRUM-17",
    url: "https://transfrmai.atlassian.net/browse/SCRUM-17",
  },
  {
    id: "t2",
    state: "created",
    externalId: "SCRUM-18",
    url: "https://transfrmai.atlassian.net/browse/SCRUM-18",
  },
  { id: "t3", state: "failed" },
];

function fixture() {
  const db = openDatabase(":memory:");
  migrate(db);
  db.prepare(
    "INSERT INTO work_areas(id,type,name,product_id,created_at) VALUES('area','product','Badge Desk',NULL,'now')",
  ).run();
  const columns = (
    db.prepare("PRAGMA table_info(work_plans)").all() as {
      name: string;
      notnull: number;
      dflt_value: unknown;
    }[]
  ).filter((c) => c.notnull && c.dflt_value === null);
  const values: Record<string, unknown> = {
    id: "plan",
    group_id: null,
    work_area_id: "area",
    kind: "stories",
    destination: "jira",
    summary: "Badge Desk to Jira",
    items_json: JSON.stringify(items),
    approved_json: JSON.stringify(items.map((i) => i.id)),
    state: "partial",
    results_json: JSON.stringify(results),
    created_at: "2026-11-22T15:06:00Z",
  };
  const names = [
    ...new Set([...columns.map((c) => c.name), ...Object.keys(values)]),
  ].filter((name) => name in values);
  db.prepare(
    `INSERT INTO work_plans(${names.join(",")}) VALUES(${names.map(() => "?").join(",")})`,
  ).run(...names.map((name) => values[name]));
  return db;
}

describe("what a work area has in Jira and Linear", () => {
  it("is Amun's record of the approved plan, grouped by epic and sprint", () => {
    const records = deliveryRecords(fixture(), "area");
    expect(
      records.map((r) => [r.kind, r.key, r.epicId, r.sprintId, r.outcome]),
    ).toEqual([
      ["epic", "SCRUM-13", null, null, "created"],
      ["sprint", "6", null, null, "created"],
      // A parent named by title and one named by plan item id both resolve.
      ["story", "SCRUM-17", "e1", "s1", "created"],
      ["story", "SCRUM-18", "e1", null, "created"],
      ["story", null, "e1", null, "failed"],
    ]);
    const sprint = records.find((r) => r.kind === "sprint")!;
    expect([sprint.start, sprint.end]).toEqual(["2026-12-07", "2026-12-18"]);
    expect(records.find((r) => r.key === "SCRUM-17")!.acceptance).toEqual([
      "Given a CSV, columns map",
      "Given bad rows, each is listed",
    ]);
  });

  it("is empty for an area with no Jira or Linear plan", () => {
    expect(deliveryRecords(fixture(), "elsewhere")).toEqual([]);
  });

  it("keeps the record and says why when the provider is not connected, without writing", async () => {
    const used: string[] = [];
    const delivery = await readDelivery(fixture(), "area", {
      configured: async () => false,
      use: async (provider) => {
        used.push(provider);
        throw Error("unexpected");
      },
    });
    expect(used).toEqual([]);
    expect(delivery.readAt).toBeNull();
    expect(delivery.unread).toEqual([
      { provider: "jira", reason: "not connected" },
    ]);
    expect(delivery.items).toHaveLength(5);
    expect(delivery.items.every((i) => i.status === null)).toBe(true);
  });

  it("reports a failed read in plain words and keeps the recorded items", async () => {
    const delivery = await readDelivery(fixture(), "area", {
      configured: async () => true,
      use: async () => {
        throw Error("Jira sites unavailable");
      },
    });
    expect(delivery.unread).toEqual([
      { provider: "jira", reason: "Jira sites unavailable" },
    ]);
    expect(delivery.items).toHaveLength(5);
  });
});
