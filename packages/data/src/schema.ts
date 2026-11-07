import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  check,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull(),
    allowed_models_json: text("allowed_models_json").notNull().default("[]"),
    created_at: text("created_at").notNull(),
  },
  () => [
    check(
      "products_allowed_models_json_valid",
      sql`json_valid(allowed_models_json)`,
    ),
  ],
);

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey().notNull(),
  product_id: text("product_id")
    .notNull()
    .references(() => products.id),
  kind: text("kind").notNull(),
  external_id: text("external_id"),
  title: text("title").notNull(),
  retrieved_at: text("retrieved_at").notNull(),
  hash: text("hash").notNull(),
});

export const memory_entities = sqliteTable(
  "memory_entities",
  {
    id: text("id").primaryKey().notNull(),
    product_id: text("product_id")
      .notNull()
      .references(() => products.id),
    type: text("type").notNull(),
    data_json: text("data_json").notNull().default("{}"),
    source_id: text("source_id")
      .notNull()
      .references(() => sources.id),
    confidence: real("confidence"),
    confirmed: integer("confirmed"),
    updated_at: text("updated_at").notNull(),
  },
  () => [
    check("memory_entities_data_json_valid", sql`json_valid(data_json)`),
    check("memory_entities_confidence_valid", sql`confidence BETWEEN 0 AND 1`),
    check("memory_entities_confirmed_valid", sql`confirmed IN (0,1)`),
  ],
);

export const memory_relations = sqliteTable(
  "memory_relations",
  {
    id: text("id").primaryKey().notNull(),
    product_id: text("product_id")
      .notNull()
      .references(() => products.id),
    type: text("type").notNull(),
    data_json: text("data_json").notNull().default("{}"),
    source_id: text("source_id")
      .notNull()
      .references(() => sources.id),
    confidence: real("confidence"),
    confirmed: integer("confirmed"),
    updated_at: text("updated_at").notNull(),
  },
  () => [
    check("memory_relations_data_json_valid", sql`json_valid(data_json)`),
    check("memory_relations_confidence_valid", sql`confidence BETWEEN 0 AND 1`),
    check("memory_relations_confirmed_valid", sql`confirmed IN (0,1)`),
  ],
);

export const objectives = sqliteTable("objectives", {
  id: text("id").primaryKey().notNull(),
  product_id: text("product_id")
    .notNull()
    .references(() => products.id),
  statement: text("statement").notNull(),
  status: text("status").notNull(),
});

export const prds = sqliteTable(
  "prds",
  {
    id: text("id").primaryKey().notNull(),
    product_id: text("product_id")
      .notNull()
      .references(() => products.id),
    objective_id: text("objective_id")
      .notNull()
      .references(() => objectives.id),
    version: integer("version"),
    content_json: text("content_json").notNull().default("{}"),
    markdown: text("markdown"),
    created_at: text("created_at").notNull(),
  },
  () => [check("prds_content_json_valid", sql`json_valid(content_json)`)],
);

export const prd_versions = sqliteTable(
  "prd_versions",
  {
    id: text("id").primaryKey().notNull(),
    product_id: text("product_id")
      .notNull()
      .references(() => products.id),
    objective_id: text("objective_id")
      .notNull()
      .references(() => objectives.id),
    prd_id: text("prd_id")
      .notNull()
      .references(() => prds.id),
    version: integer("version"),
    content_json: text("content_json").notNull().default("{}"),
    markdown: text("markdown"),
    created_at: text("created_at").notNull(),
  },
  () => [
    check("prd_versions_content_json_valid", sql`json_valid(content_json)`),
  ],
);

export const work_items = sqliteTable(
  "work_items",
  {
    id: text("id").primaryKey().notNull(),
    product_id: text("product_id")
      .notNull()
      .references(() => products.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    acceptance_json: text("acceptance_json").notNull().default("[]"),
    points: real("points"),
    parent_id: text("parent_id"),
    requirement_ids: text("requirement_ids").notNull().default("[]"),
    status: text("status").notNull(),
    remote_system: text("remote_system"),
    remote_id: text("remote_id"),
    remote_rev: integer("remote_rev"),
  },
  () => [
    check("work_items_acceptance_json_valid", sql`json_valid(acceptance_json)`),
    check("work_items_requirement_ids_valid", sql`json_valid(requirement_ids)`),
  ],
);

export const sprints = sqliteTable("sprints", {
  id: text("id").primaryKey().notNull(),
  product_id: text("product_id")
    .notNull()
    .references(() => products.id),
  remote_iteration_id: text("remote_iteration_id"),
  path: text("path"),
  start: text("start"),
  end: text("end"),
});

export const attention_items = sqliteTable(
  "attention_items",
  {
    id: text("id").primaryKey().notNull(),
    product_id: text("product_id")
      .notNull()
      .references(() => products.id),
    type: text("type").notNull(),
    origin_kind: text("origin_kind").notNull(),
    origin_label: text("origin_label").notNull(),
    firstmate_ref: text("firstmate_ref"),
    ask: text("ask").notNull(),
    detail: text("detail"),
    blocking_refs: text("blocking_refs").notNull().default("[]"),
    primary_action_json: text("primary_action_json").notNull().default("{}"),
    governed: integer("governed"),
    state: text("state").notNull(),
    snoozed_until: text("snoozed_until"),
    resolved_by: text("resolved_by"),
    resolved_at: text("resolved_at"),
    created_at: text("created_at").notNull(),
  },
  () => [
    check(
      "attention_items_blocking_refs_valid",
      sql`json_valid(blocking_refs)`,
    ),
    check(
      "attention_items_primary_action_json_valid",
      sql`json_valid(primary_action_json)`,
    ),
    check("attention_items_governed_valid", sql`governed IN (0,1)`),
  ],
);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey().notNull(),
  product_id: text("product_id")
    .notNull()
    .references(() => products.id),
  kind: text("kind").notNull(),
  text: text("text").notNull(),
  ref: text("ref"),
  read_at: text("read_at"),
  created_at: text("created_at").notNull(),
});

export const decisions = sqliteTable(
  "decisions",
  {
    id: text("id").primaryKey().notNull(),
    product_id: text("product_id")
      .notNull()
      .references(() => products.id),
    question: text("question").notNull(),
    options_json: text("options_json").notNull().default("[]"),
    chosen: text("chosen"),
    rationale: text("rationale"),
    sources_json: text("sources_json").notNull().default("[]"),
    decided_by: text("decided_by"),
    decided_at: text("decided_at"),
  },
  () => [
    check("decisions_options_json_valid", sql`json_valid(options_json)`),
    check("decisions_sources_json_valid", sql`json_valid(sources_json)`),
  ],
);

export const actions = sqliteTable(
  "actions",
  {
    id: text("id").primaryKey().notNull(),
    product_id: text("product_id").references(() => products.id),
    kind: text("kind").notNull(),
    payload_json: text("payload_json").notNull().default("{}"),
    payload_hash: text("payload_hash").notNull(),
    target_revisions_json: text("target_revisions_json")
      .notNull()
      .default("{}"),
    state: text("state").notNull(),
    requested_by: text("requested_by").notNull(),
    operation_marker: text("operation_marker").notNull().unique(),
  },
  () => [
    check(
      "actions_workspace_kind",
      sql`product_id IS NOT NULL OR kind IN ('notion_publish','github_issue')`,
    ),
    check("actions_payload_json_valid", sql`json_valid(payload_json)`),
    check(
      "actions_target_revisions_json_valid",
      sql`json_valid(target_revisions_json)`,
    ),
  ],
);

export const approvals = sqliteTable(
  "approvals",
  {
    id: text("id").primaryKey().notNull(),
    action_id: text("action_id").references(() => actions.id),
    prd_version_id: text("prd_version_id").references(() => prd_versions.id),
    decision: text("decision").notNull(),
    kind: text("kind").notNull(),
    payload_hash: text("payload_hash").notNull(),
    target_revisions_json: text("target_revisions_json")
      .notNull()
      .default("{}"),
    approved_by: text("approved_by").notNull(),
    approved_at: text("approved_at").notNull(),
    invalidated_reason: text("invalidated_reason"),
  },
  () => [
    check(
      "approvals_target_revisions_json_valid",
      sql`json_valid(target_revisions_json)`,
    ),
    check(
      "approval_target",
      sql`(action_id IS NOT NULL) != (prd_version_id IS NOT NULL)`,
    ),
  ],
);

export const outbox = sqliteTable(
  "outbox",
  {
    id: text("id").primaryKey().notNull(),
    action_id: text("action_id")
      .notNull()
      .references(() => actions.id),
    step: text("step").notNull(),
    attempt: integer("attempt"),
    next_attempt_at: text("next_attempt_at"),
    last_error: text("last_error"),
    state: text("state").notNull(),
  },
  (t) => [
    check("outbox_attempt_valid", sql`attempt >= 0`),
    uniqueIndex("outbox_action_step").on(t.action_id, t.step),
  ],
);

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey().notNull(),
  product_id: text("product_id")
    .notNull()
    .references(() => products.id),
  story_id: text("story_id"),
  agent_role: text("agent_role").notNull(),
  harness: text("harness").notNull(),
  model: text("model"),
  firstmate_task_id: text("firstmate_task_id"),
  backend: text("backend"),
  pane_ref: text("pane_ref"),
  worktree: text("worktree"),
  branch: text("branch"),
  state: text("state").notNull(),
  started_at: text("started_at").notNull(),
});

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey().notNull(),
  product_id: text("product_id")
    .notNull()
    .references(() => products.id),
  kind: text("kind").notNull(),
  path_or_uri: text("path_or_uri").notNull(),
  run_id: text("run_id").references(() => runs.id),
});

export const sync_links = sqliteTable("sync_links", {
  id: text("id").primaryKey().notNull(),
  local_ref: text("local_ref").notNull(),
  remote_system: text("remote_system").notNull(),
  remote_id: text("remote_id").notNull(),
  last_synced_at: text("last_synced_at"),
  local_hash: text("local_hash"),
  remote_edited_at: text("remote_edited_at"),
  state: text("state").notNull(),
});

export const reminders = sqliteTable("reminders", {
  id: text("id").primaryKey().notNull(),
  due_at: text("due_at"),
  recurrence: text("recurrence"),
  state: text("state").notNull(),
  notion_ref: text("notion_ref"),
});

export const personal_tasks = sqliteTable("personal_tasks", {
  id: text("id").primaryKey().notNull(),
  due_at: text("due_at"),
  recurrence: text("recurrence"),
  state: text("state").notNull(),
  notion_ref: text("notion_ref"),
});

export const skills = sqliteTable("skills", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  source_url: text("source_url").notNull(),
  version: text("version").notNull(),
  content_hash: text("content_hash").notNull(),
  approved_at: text("approved_at"),
});

export const audit_log = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey().notNull(),
    at: text("at").notNull(),
    actor: text("actor").notNull(),
    event: text("event").notNull(),
    ref: text("ref"),
    details_json: text("details_json").notNull().default("{}"),
  },
  () => [check("audit_log_details_json_valid", sql`json_valid(details_json)`)],
);

export const workspace_settings = sqliteTable(
  "workspace_settings",
  {
    id: text("id").primaryKey().notNull(),
    value_json: text("value_json").notNull().default("{}"),
  },
  () => [
    check("workspace_settings_value_json_valid", sql`json_valid(value_json)`),
  ],
);
