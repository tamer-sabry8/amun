/* Append-only migrations: released entries must never be edited. */
export const migrations = [
  `CREATE TABLE products (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  allowed_models_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  CONSTRAINT products_allowed_models_json_valid CHECK (json_valid(allowed_models_json))
);
CREATE TABLE sources (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  kind TEXT NOT NULL,
  external_id TEXT,
  title TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE TABLE memory_entities (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  type TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  source_id TEXT NOT NULL REFERENCES sources(id),
  confidence REAL,
  confirmed INTEGER,
  updated_at TEXT NOT NULL,
  CONSTRAINT memory_entities_data_json_valid CHECK (json_valid(data_json)),
  CONSTRAINT memory_entities_confidence_valid CHECK (confidence BETWEEN 0 AND 1),
  CONSTRAINT memory_entities_confirmed_valid CHECK (confirmed IN (0,1))
);
CREATE TABLE memory_relations (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  type TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  source_id TEXT NOT NULL REFERENCES sources(id),
  confidence REAL,
  confirmed INTEGER,
  updated_at TEXT NOT NULL,
  CONSTRAINT memory_relations_data_json_valid CHECK (json_valid(data_json)),
  CONSTRAINT memory_relations_confidence_valid CHECK (confidence BETWEEN 0 AND 1),
  CONSTRAINT memory_relations_confirmed_valid CHECK (confirmed IN (0,1))
);
CREATE TABLE objectives (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  statement TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE prds (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  objective_id TEXT NOT NULL REFERENCES objectives(id),
  version INTEGER,
  content_json TEXT NOT NULL DEFAULT '{}',
  markdown TEXT,
  created_at TEXT NOT NULL,
  CONSTRAINT prds_content_json_valid CHECK (json_valid(content_json))
);
CREATE TABLE prd_versions (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  objective_id TEXT NOT NULL REFERENCES objectives(id),
  prd_id TEXT NOT NULL REFERENCES prds(id),
  version INTEGER,
  content_json TEXT NOT NULL DEFAULT '{}',
  markdown TEXT,
  created_at TEXT NOT NULL,
  CONSTRAINT prd_versions_content_json_valid CHECK (json_valid(content_json))
);
CREATE TABLE work_items (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  acceptance_json TEXT NOT NULL DEFAULT '[]',
  points REAL,
  parent_id TEXT,
  requirement_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  remote_system TEXT,
  remote_id TEXT,
  remote_rev INTEGER,
  CONSTRAINT work_items_acceptance_json_valid CHECK (json_valid(acceptance_json)),
  CONSTRAINT work_items_requirement_ids_valid CHECK (json_valid(requirement_ids))
);
CREATE TABLE sprints (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  remote_iteration_id TEXT,
  path TEXT,
  start TEXT,
  end TEXT
);
CREATE TABLE attention_items (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  type TEXT NOT NULL,
  origin_kind TEXT NOT NULL,
  origin_label TEXT NOT NULL,
  firstmate_ref TEXT,
  ask TEXT NOT NULL,
  detail TEXT,
  blocking_refs TEXT NOT NULL DEFAULT '[]',
  primary_action_json TEXT NOT NULL DEFAULT '{}',
  governed INTEGER,
  state TEXT NOT NULL,
  snoozed_until TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  CONSTRAINT attention_items_blocking_refs_valid CHECK (json_valid(blocking_refs)),
  CONSTRAINT attention_items_primary_action_json_valid CHECK (json_valid(primary_action_json)),
  CONSTRAINT attention_items_governed_valid CHECK (governed IN (0,1))
);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  ref TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE decisions (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  question TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '[]',
  chosen TEXT,
  rationale TEXT,
  sources_json TEXT NOT NULL DEFAULT '[]',
  decided_by TEXT,
  decided_at TEXT,
  CONSTRAINT decisions_options_json_valid CHECK (json_valid(options_json)),
  CONSTRAINT decisions_sources_json_valid CHECK (json_valid(sources_json))
);
CREATE TABLE actions (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  payload_hash TEXT NOT NULL,
  target_revisions_json TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  operation_marker TEXT NOT NULL UNIQUE,
  CONSTRAINT actions_payload_json_valid CHECK (json_valid(payload_json)),
  CONSTRAINT actions_target_revisions_json_valid CHECK (json_valid(target_revisions_json))
);
CREATE TABLE approvals (
  id TEXT PRIMARY KEY NOT NULL,
  action_id TEXT REFERENCES actions(id),
  prd_version_id TEXT REFERENCES prd_versions(id),
  decision TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  target_revisions_json TEXT NOT NULL DEFAULT '{}',
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  invalidated_reason TEXT,
  CONSTRAINT approvals_target_revisions_json_valid CHECK (json_valid(target_revisions_json)),
  CHECK ((action_id IS NOT NULL) != (prd_version_id IS NOT NULL))
);
CREATE TABLE outbox (
  id TEXT PRIMARY KEY NOT NULL,
  action_id TEXT NOT NULL REFERENCES actions(id),
  step TEXT NOT NULL,
  attempt INTEGER,
  next_attempt_at TEXT,
  last_error TEXT,
  state TEXT NOT NULL,
  CONSTRAINT outbox_attempt_valid CHECK (attempt >= 0),
  UNIQUE(action_id,step)
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  story_id TEXT,
  agent_role TEXT NOT NULL,
  harness TEXT NOT NULL,
  model TEXT,
  firstmate_task_id TEXT,
  backend TEXT,
  pane_ref TEXT,
  worktree TEXT,
  branch TEXT,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL
);
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  kind TEXT NOT NULL,
  path_or_uri TEXT NOT NULL,
  run_id TEXT REFERENCES runs(id)
);
CREATE TABLE sync_links (
  id TEXT PRIMARY KEY NOT NULL,
  local_ref TEXT NOT NULL,
  remote_system TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  last_synced_at TEXT,
  local_hash TEXT,
  remote_edited_at TEXT,
  state TEXT NOT NULL
);
CREATE TABLE reminders (
  id TEXT PRIMARY KEY NOT NULL,
  due_at TEXT,
  recurrence TEXT,
  state TEXT NOT NULL,
  notion_ref TEXT
);
CREATE TABLE personal_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  due_at TEXT,
  recurrence TEXT,
  state TEXT NOT NULL,
  notion_ref TEXT
);
CREATE TABLE skills (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  approved_at TEXT
);
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  event TEXT NOT NULL,
  ref TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  CONSTRAINT audit_log_details_json_valid CHECK (json_valid(details_json))
);
CREATE TABLE workspace_settings (
  id TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL DEFAULT '{}',
  CONSTRAINT workspace_settings_value_json_valid CHECK (json_valid(value_json))
);`,
  `CREATE VIRTUAL TABLE search_index USING fts5(product_id UNINDEXED, entity_id UNINDEXED, kind UNINDEXED, title, body);
CREATE INDEX attention_product_state ON attention_items(product_id,state,created_at);
CREATE INDEX outbox_state_due ON outbox(state,next_attempt_at);`,
] as const;
