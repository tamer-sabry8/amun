// Incident: Beta 0.9 stayed on "Opening Amun…" for a profile created by builds
// up to 687221a (database at migration 35). This opens such a database the
// way the new build does: apply migrations 36–40, build the snapshot, and read
// it with the same contract the renderer uses.
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { WorkStore } from "../src/work-store.ts";
import {
  failureReasons,
  workEvent,
  workSnapshot,
} from "../../contracts/src/work.ts";

const T = "2026-10-20T08:00:00.000Z";
function insert(db: Database.Database, table: string, row: object) {
  const keys = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table}(${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
  ).run(...Object.values(row));
}

/** Rows as the work store of build 687221a wrote them, with optional columns empty. */
function legacyProfile() {
  const db = new Database(":memory:");
  migrate(db, 35);
  const add = (table: string, row: object) => insert(db, table, row);
  add("products", { id: "p1", name: "Keyboard", created_at: T });
  add("products", { id: "p2", name: "Old product", created_at: T });
  add("work_groups", {
    id: "g1",
    name: "Employer",
    position: 0,
    created_at: T,
  });
  add("work_groups", { id: "g2", name: "Side", position: 1, created_at: T });
  add("routing_rules", {
    id: "r1",
    group_id: "g1",
    condition: "delivery",
    tracker: "ado",
    created_at: T,
  });
  add("routing_rules", {
    id: "r2",
    group_id: "g1",
    condition: null,
    tracker: "notion",
    created_at: T,
  });
  add("work_areas", {
    id: "a1",
    group_id: "g1",
    type: "product",
    name: "Keyboard",
    product_id: "p1",
    created_at: T,
  });
  add("work_areas", {
    id: "a2",
    group_id: null,
    type: "project",
    name: "Ungrouped",
    created_at: T,
  });
  add("work_areas", {
    id: "a3",
    group_id: "g1",
    type: "rfp",
    name: "Tender",
    client: "Acme",
    due_at: "2026-12-01",
    effort: "M",
    declined_shape_json: '{"milestones":2,"people":1,"steps":3}',
    created_at: T,
  });
  add("work_areas", {
    id: "a4",
    group_id: "g1",
    type: "task",
    name: "Removed",
    status: "deleted",
    created_at: T,
  });
  add("work_area_relations", { from_id: "a3", to_id: "a1", kind: "handoff" });
  add("work_records", {
    id: "rec1",
    group_id: "g1",
    type: "idea",
    title: "An idea",
    body: "",
    linkage: "link_later",
    created_at: T,
    updated_at: T,
  });
  add("work_records", {
    id: "rec2",
    group_id: null,
    type: "interview",
    title: "Interview",
    body: "Notes about pricing",
    linkage: "linked",
    created_at: T,
    updated_at: T,
  });
  add("work_record_links", { record_id: "rec2", work_area_id: "a1" });
  add("findings", {
    id: "f1",
    record_id: "rec2",
    text: "Pricing is unclear",
    created_at: T,
  });
  add("work_objectives", {
    id: "o1",
    group_id: "g1",
    metric: "Reach 1000 users",
    baseline: null,
    target: 1000,
    current: null,
    conflict: 0,
  });
  add("work_objectives", {
    id: "o2",
    group_id: null,
    metric: "Cut cost",
    baseline: 10,
    target: 5,
    current: 7,
    evidence_date: "2026-10-01",
    review_date: "2026-12-01",
    conflict: 1,
  });
  add("work_objective_links", { objective_id: "o1", work_area_id: "a1" });
  add("standing_permissions", {
    id: "sp1",
    group_id: "g1",
    destination: "ado",
    action: "create",
    created_at: T,
  });
  add("standing_permissions", {
    id: "sp2",
    group_id: "g1",
    destination: "notion",
    action: "create",
    created_at: T,
    revoked_at: T,
  });
  add("cross_group_grants", {
    id: "cg1",
    source_group_id: "g1",
    target_group_id: "g2",
    information: "Dates",
    purpose: "Planning",
    created_at: T,
    revoked_at: T,
  });
  add("learned_rules", {
    id: "lr1",
    group_id: "g1",
    situation: "Bug",
    resolution: "Fix it",
    state: "active",
    uses: 2,
    created_at: T,
  });
  add("rule_cases", {
    group_id: "g1",
    situation: "Bug",
    resolution: "Fix it",
    event_id: "e1",
    created_at: T,
  });
  add("work_attention", {
    id: "at1",
    kind: "question",
    group_id: null,
    work_area_id: null,
    title: "Which sprint?",
    state: "open",
    created_at: T,
  });
  add("work_attention", {
    id: "at2",
    kind: "approval",
    group_id: "g1",
    work_area_id: "a1",
    title: "Approve",
    detail: "x",
    state: "snoozed",
    ref: "plan:pl1",
    options_json: '["Yes","No"]',
    snoozed_until: "2099-01-01T00:00:00.000Z",
    created_at: T,
  });
  const items = JSON.stringify([
    {
      id: "i1",
      summary: "Story",
      fields: { title: "Story", points: 3, x: null },
    },
  ]);
  add("work_plans", {
    id: "pl1",
    group_id: "g1",
    work_area_id: "a1",
    kind: "stories",
    destination: "ado",
    summary: "Plan",
    items_json: items,
    approved_json: items,
    state: "partial",
    results_json: JSON.stringify([
      {
        id: "i1",
        state: "created",
        externalId: "12",
        url: "https://x.test/12",
      },
      { id: "i2", state: "created", externalId: "13", linked: true },
      { id: "i3", state: "failed" },
    ]),
    created_at: T,
    approved_at: T,
  });
  add("plan_writes", {
    plan_id: "pl1",
    item_id: "i1",
    marker: "m1",
    destination: "ado",
    state: "created",
    external_id: "12",
    url: "https://x.test/12",
    attempts: 1,
  });
  add("plan_writes", {
    plan_id: "pl1",
    item_id: "i3",
    marker: "m3",
    destination: "ado",
    state: "unknown",
    attempts: 2,
    note: "Not sent",
  });
  add("work_plans", {
    id: "pl2",
    group_id: null,
    work_area_id: null,
    kind: "edit",
    destination: "notion",
    items_json: "[]",
    state: "proposed",
    created_at: T,
  });
  add("rfps", { work_area_id: "a3", client: "Acme", stage: "received" });
  add("roadmap_items", {
    id: "rm1",
    work_area_id: "a1",
    title: "Launch",
    horizon: "now",
    position: 0,
  });
  add("work_sprints", {
    id: "s1",
    work_area_id: "a1",
    name: "Sprint 1",
    start: "2026-10-01",
    end: "2026-10-14",
  });
  add("calendar_exceptions", { date: "2026-12-25", label: "Holiday" });
  add("library_outputs", {
    id: "d1",
    group_id: "g1",
    type: "prd",
    title: "PRD",
    body: "Pricing and prices",
    status: "Approved",
    created_at: T,
    updated_at: T,
    approved_version: 2,
    approved_at: T,
  });
  add("library_outputs", {
    id: "d2",
    group_id: null,
    type: "report",
    title: "Report",
    created_at: T,
    updated_at: T,
  });
  for (const [output, version, author] of [
    ["d1", 1, "firstmate"],
    ["d1", 2, "owner"],
    ["d2", 1, "agent"],
  ] as const)
    add("library_output_versions", {
      output_id: output,
      version,
      body: "text",
      author,
      created_at: T,
    });
  add("library_output_links", { output_id: "d1", work_area_id: "a1" });
  add("decision_log", {
    id: "dl1",
    what: "Pick a database",
    source: "conversation",
    created_at: T,
  });
  add("work_agents", {
    id: "ag1",
    role: "Lead",
    kind: "lead",
    state: "idle",
    created_at: T,
  });
  add("work_activity", {
    id: "ac1",
    text: "Did it",
    state: "finished",
    created_at: T,
  });
  add("council_sessions", {
    id: "cs1",
    decision: "Go?",
    mode: "default",
    state: "finished",
    created_at: T,
  });
  add("memory_claims", {
    id: "m1",
    group_id: "g1",
    key: "client",
    value: "Acme",
    source: "chat",
    observed_at: T,
    state: "current",
    created_at: T,
  });
  for (const [id, role, card] of [
    ["ms1", "you", null],
    ["ms2", "firstmate", null],
    ["ms3", "card", '{"kind":"note"}'],
  ] as const)
    add("work_messages", {
      id,
      work_area_id: "a1",
      role,
      text: "Hello pricing",
      card_json: card,
      created_at: T,
    });
  add("work_blockers", {
    id: "b1",
    work_area_id: "a1",
    title: "Waiting",
    raised_at: T,
  });
  return db;
}

describe("incident: Beta 0.9 stuck on Opening Amun… (legacy profile)", () => {
  it("builds a snapshot the renderer accepts from a migration-35 database", () => {
    const db = legacyProfile();
    migrate(db);
    const snapshot = new WorkStore(db).snapshot();
    expect(snapshot.areas.map((area) => area.id)).toContain("a1");
    // What crosses the message port is parsed again with the renderer's contract.
    const received = workEvent.safeParse(structuredClone(snapshot));
    expect(received.success).toBe(true);
    expect(snapshot.objectives.every((o) => o.dueDate === null)).toBe(true);
    expect(snapshot.library.every((item) => item.acceptance === null)).toBe(
      true,
    );
    expect(snapshot.reminders).toEqual([]);
  });

  it("keeps every legacy row through the new migrations", () => {
    const db = legacyProfile();
    migrate(db);
    const snapshot = new WorkStore(db).snapshot();
    expect(snapshot.library.find((i) => i.id === "d1")?.approvedVersion).toBe(
      2,
    );
    expect(snapshot.plans[0]?.results).toHaveLength(3);
    expect(snapshot.permissions).toHaveLength(2);
    expect(snapshot.messages).toHaveLength(3);
  });

  it("reports where a snapshot breaks the contract without any values", () => {
    const broken = workSnapshot.safeParse({ kind: "work-snapshot", secret: 1 });
    if (broken.success) throw Error("expected a failure");
    const reasons = failureReasons(broken.error);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.join()).toMatch(/invalid_type|unrecognized_keys/);
    expect(reasons.join()).not.toContain("work-snapshot-value");
    expect(failureReasons(new Error("token=abc"))).toEqual([
      "(snapshot): Error",
    ]);
  });
});
