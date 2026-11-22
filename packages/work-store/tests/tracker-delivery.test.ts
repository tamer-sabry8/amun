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
      ["story", "SCRUM-17", "plan:e1", "plan:s1", "created"],
      ["story", "SCRUM-18", "plan:e1", null, "created"],
      ["story", null, "plan:e1", null, "failed"],
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

// Codex review on #61.
function addPlan(
  db: ReturnType<typeof fixture>,
  id: string,
  planItems: unknown[],
  planResults: unknown[],
  destination = "jira",
) {
  const row = db
    .prepare("SELECT * FROM work_plans WHERE id='plan'")
    .get() as Record<string, unknown>;
  const values = {
    ...row,
    id,
    destination,
    items_json: JSON.stringify(planItems),
    results_json: JSON.stringify(planResults),
    approved_json: JSON.stringify(
      (planItems as { id: string }[]).map((i) => i.id),
    ),
  };
  const names = Object.keys(values);
  db.prepare(
    `INSERT INTO work_plans(${names.join(",")}) VALUES(${names.map(() => "?").join(",")})`,
  ).run(...names.map((n) => (values as Record<string, unknown>)[n]));
}

describe("read-back across plans, sites and memberships", () => {
  it("keeps each plan's items with their own epic when plans reuse item ids", () => {
    const db = fixture();
    addPlan(
      db,
      "plan2",
      [
        { id: "e1", summary: "Second epic", fields: { ...site, type: "Epic" } },
        {
          id: "t1",
          summary: "Second task",
          fields: { ...site, type: "Task", parent: "e1" },
        },
      ],
      [
        {
          id: "e1",
          state: "created",
          externalId: "SCRUM-40",
          url: "https://transfrmai.atlassian.net/browse/SCRUM-40",
        },
        {
          id: "t1",
          state: "created",
          externalId: "SCRUM-41",
          url: "https://transfrmai.atlassian.net/browse/SCRUM-41",
        },
      ],
    );
    const records = deliveryRecords(db, "area");
    expect(records.find((r) => r.key === "SCRUM-41")!.epicId).toBe("plan2:e1");
    expect(records.find((r) => r.key === "SCRUM-17")!.epicId).toBe("plan:e1");
  });

  it("names an existing provider sprint or Linear cycle by the provider's scope", () => {
    const db = fixture();
    addPlan(
      db,
      "linear",
      [
        {
          id: "i1",
          summary: "Bill a client",
          fields: {
            site: "transfrmai",
            team: "TRA",
            type: "Issue",
            sprint: "4",
          },
        },
      ],
      [
        {
          id: "i1",
          state: "created",
          externalId: "TRA-12",
          url: "https://linear.app/transfrmai/issue/TRA-12",
        },
      ],
      "linear",
    );
    expect(
      deliveryRecords(db, "area").find((r) => r.key === "TRA-12")!.sprintId,
    ).toBe("linear:cycle:4");
  });

  it("reads each Jira item from its own site and drops a sprint Jira no longer reports", async () => {
    const db = fixture();
    addPlan(
      db,
      "other-site",
      [
        {
          id: "x1",
          summary: "Other site task",
          fields: { site: "other.atlassian.net", project: "OPS", type: "Task" },
        },
      ],
      [
        {
          id: "x1",
          state: "created",
          externalId: "OPS-1",
          url: "https://other.atlassian.net/browse/OPS-1",
        },
      ],
    );
    const asked: [string, string][] = [];
    const json = (value: unknown) => ({
      content: [{ type: "text", text: JSON.stringify(value) }],
    });
    const session = {
      tools: [
        "getAccessibleAtlassianResources",
        "getJiraIssue",
        "executeRead",
      ].map((name) => ({ name })),
      async call(name: string, args: Record<string, unknown>) {
        if (name === "getAccessibleAtlassianResources")
          return json({
            data: {
              resources: [
                { cloudId: "c-main", url: "https://transfrmai.atlassian.net" },
                { cloudId: "c-other", url: "https://other.atlassian.net" },
              ],
            },
          });
        if (name === "executeRead")
          return json({ data: { values: [], isLast: true } });
        asked.push([String(args.cloudId), String(args.issueIdOrKey)]);
        return json({
          data: {
            key: args.issueIdOrKey,
            // Jira now reports SCRUM-17 in no sprint at all.
            fields: {
              summary: "Now",
              status: { name: "In Progress" },
              customFields: { Sprint: { value: [] } },
            },
          },
        });
      },
    };
    const delivery = await readDelivery(db, "area", {
      configured: async () => true,
      use: async (_provider, work) => work(session),
    });
    expect(asked).toContainEqual(["c-main", "SCRUM-17"]);
    expect(asked).toContainEqual(["c-other", "OPS-1"]);
    expect(asked).not.toContainEqual(["c-main", "OPS-1"]);
    const moved = delivery.items.find((i) => i.key === "SCRUM-17")!;
    expect(moved.status).toBe("In Progress");
    expect(moved.sprintId).toBeNull();
  });
});
