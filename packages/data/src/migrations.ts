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
  `CREATE TRIGGER search_products_insert AFTER INSERT ON products BEGIN INSERT INTO search_index(product_id,entity_id,kind,title,body) VALUES (new.id,new.id,'product',COALESCE(new.name,''),''); END;
CREATE TRIGGER search_products_update AFTER UPDATE ON products BEGIN DELETE FROM search_index WHERE product_id=old.id AND entity_id=old.id AND kind='product'; INSERT INTO search_index(product_id,entity_id,kind,title,body) VALUES (new.id,new.id,'product',COALESCE(new.name,''),''); END;
CREATE TRIGGER search_products_delete AFTER DELETE ON products BEGIN DELETE FROM search_index WHERE product_id=old.id AND entity_id=old.id AND kind='product'; END;
INSERT INTO search_index(product_id,entity_id,kind,title,body) SELECT id,id,'product',COALESCE(name,''),'' FROM products;
CREATE TRIGGER search_attention_items_insert AFTER INSERT ON attention_items BEGIN INSERT INTO search_index(product_id,entity_id,kind,title,body) VALUES (new.product_id,new.id,'request',COALESCE(new.ask,''),COALESCE(new.detail,'')); END;
CREATE TRIGGER search_attention_items_update AFTER UPDATE ON attention_items BEGIN DELETE FROM search_index WHERE product_id=old.product_id AND entity_id=old.id AND kind='request'; INSERT INTO search_index(product_id,entity_id,kind,title,body) VALUES (new.product_id,new.id,'request',COALESCE(new.ask,''),COALESCE(new.detail,'')); END;
CREATE TRIGGER search_attention_items_delete AFTER DELETE ON attention_items BEGIN DELETE FROM search_index WHERE product_id=old.product_id AND entity_id=old.id AND kind='request'; END;
INSERT INTO search_index(product_id,entity_id,kind,title,body) SELECT product_id,id,'request',COALESCE(ask,''),COALESCE(detail,'') FROM attention_items;
CREATE TRIGGER search_objectives_insert AFTER INSERT ON objectives BEGIN INSERT INTO search_index(product_id,entity_id,kind,title,body) VALUES (new.product_id,new.id,'objective',COALESCE(new.statement,''),''); END;
CREATE TRIGGER search_objectives_update AFTER UPDATE ON objectives BEGIN DELETE FROM search_index WHERE product_id=old.product_id AND entity_id=old.id AND kind='objective'; INSERT INTO search_index(product_id,entity_id,kind,title,body) VALUES (new.product_id,new.id,'objective',COALESCE(new.statement,''),''); END;
CREATE TRIGGER search_objectives_delete AFTER DELETE ON objectives BEGIN DELETE FROM search_index WHERE product_id=old.product_id AND entity_id=old.id AND kind='objective'; END;
INSERT INTO search_index(product_id,entity_id,kind,title,body) SELECT product_id,id,'objective',COALESCE(statement,''),'' FROM objectives;
CREATE TRIGGER search_work_items_insert AFTER INSERT ON work_items BEGIN INSERT INTO search_index(product_id,entity_id,kind,title,body) VALUES (new.product_id,new.id,'work_item',COALESCE(new.title,''),COALESCE(new.body,'')); END;
CREATE TRIGGER search_work_items_update AFTER UPDATE ON work_items BEGIN DELETE FROM search_index WHERE product_id=old.product_id AND entity_id=old.id AND kind='work_item'; INSERT INTO search_index(product_id,entity_id,kind,title,body) VALUES (new.product_id,new.id,'work_item',COALESCE(new.title,''),COALESCE(new.body,'')); END;
CREATE TRIGGER search_work_items_delete AFTER DELETE ON work_items BEGIN DELETE FROM search_index WHERE product_id=old.product_id AND entity_id=old.id AND kind='work_item'; END;
INSERT INTO search_index(product_id,entity_id,kind,title,body) SELECT product_id,id,'work_item',COALESCE(title,''),COALESCE(body,'') FROM work_items;
CREATE TRIGGER search_prds_insert AFTER INSERT ON prds BEGIN INSERT INTO search_index(product_id,entity_id,kind,title,body) VALUES (new.product_id,new.id,'prd',COALESCE(new.id,''),COALESCE(new.markdown,'')); END;
CREATE TRIGGER search_prds_update AFTER UPDATE ON prds BEGIN DELETE FROM search_index WHERE product_id=old.product_id AND entity_id=old.id AND kind='prd'; INSERT INTO search_index(product_id,entity_id,kind,title,body) VALUES (new.product_id,new.id,'prd',COALESCE(new.id,''),COALESCE(new.markdown,'')); END;
CREATE TRIGGER search_prds_delete AFTER DELETE ON prds BEGIN DELETE FROM search_index WHERE product_id=old.product_id AND entity_id=old.id AND kind='prd'; END;
INSERT INTO search_index(product_id,entity_id,kind,title,body) SELECT product_id,id,'prd',COALESCE(id,''),COALESCE(markdown,'') FROM prds;
CREATE TRIGGER search_decisions_insert AFTER INSERT ON decisions BEGIN INSERT INTO search_index(product_id,entity_id,kind,title,body) VALUES (new.product_id,new.id,'decision',COALESCE(new.question,''),COALESCE(new.rationale,'')); END;
CREATE TRIGGER search_decisions_update AFTER UPDATE ON decisions BEGIN DELETE FROM search_index WHERE product_id=old.product_id AND entity_id=old.id AND kind='decision'; INSERT INTO search_index(product_id,entity_id,kind,title,body) VALUES (new.product_id,new.id,'decision',COALESCE(new.question,''),COALESCE(new.rationale,'')); END;
CREATE TRIGGER search_decisions_delete AFTER DELETE ON decisions BEGIN DELETE FROM search_index WHERE product_id=old.product_id AND entity_id=old.id AND kind='decision'; END;
INSERT INTO search_index(product_id,entity_id,kind,title,body) SELECT product_id,id,'decision',COALESCE(question,''),COALESCE(rationale,'') FROM decisions;
CREATE TRIGGER search_runs_insert AFTER INSERT ON runs BEGIN INSERT INTO search_index(product_id,entity_id,kind,title,body) VALUES (new.product_id,new.id,'run',COALESCE(new.agent_role,''),COALESCE(new.branch,'')); END;
CREATE TRIGGER search_runs_update AFTER UPDATE ON runs BEGIN DELETE FROM search_index WHERE product_id=old.product_id AND entity_id=old.id AND kind='run'; INSERT INTO search_index(product_id,entity_id,kind,title,body) VALUES (new.product_id,new.id,'run',COALESCE(new.agent_role,''),COALESCE(new.branch,'')); END;
CREATE TRIGGER search_runs_delete AFTER DELETE ON runs BEGIN DELETE FROM search_index WHERE product_id=old.product_id AND entity_id=old.id AND kind='run'; END;
INSERT INTO search_index(product_id,entity_id,kind,title,body) SELECT product_id,id,'run',COALESCE(agent_role,''),COALESCE(branch,'') FROM runs;
CREATE TRIGGER search_artifacts_insert AFTER INSERT ON artifacts BEGIN INSERT INTO search_index(product_id,entity_id,kind,title,body) VALUES (new.product_id,new.id,'artifact',COALESCE(new.kind,''),COALESCE(new.path_or_uri,'')); END;
CREATE TRIGGER search_artifacts_update AFTER UPDATE ON artifacts BEGIN DELETE FROM search_index WHERE product_id=old.product_id AND entity_id=old.id AND kind='artifact'; INSERT INTO search_index(product_id,entity_id,kind,title,body) VALUES (new.product_id,new.id,'artifact',COALESCE(new.kind,''),COALESCE(new.path_or_uri,'')); END;
CREATE TRIGGER search_artifacts_delete AFTER DELETE ON artifacts BEGIN DELETE FROM search_index WHERE product_id=old.product_id AND entity_id=old.id AND kind='artifact'; END;
INSERT INTO search_index(product_id,entity_id,kind,title,body) SELECT product_id,id,'artifact',COALESCE(kind,''),COALESCE(path_or_uri,'') FROM artifacts;
CREATE TRIGGER search_memory_entities_insert AFTER INSERT ON memory_entities BEGIN INSERT INTO search_index(product_id,entity_id,kind,title,body) VALUES (new.product_id,new.id,'memory',COALESCE(new.type,''),COALESCE(new.data_json,'')); END;
CREATE TRIGGER search_memory_entities_update AFTER UPDATE ON memory_entities BEGIN DELETE FROM search_index WHERE product_id=old.product_id AND entity_id=old.id AND kind='memory'; INSERT INTO search_index(product_id,entity_id,kind,title,body) VALUES (new.product_id,new.id,'memory',COALESCE(new.type,''),COALESCE(new.data_json,'')); END;
CREATE TRIGGER search_memory_entities_delete AFTER DELETE ON memory_entities BEGIN DELETE FROM search_index WHERE product_id=old.product_id AND entity_id=old.id AND kind='memory'; END;
INSERT INTO search_index(product_id,entity_id,kind,title,body) SELECT product_id,id,'memory',COALESCE(type,''),COALESCE(data_json,'') FROM memory_entities;`,
  `CREATE TABLE actions_workspace_upgrade (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT REFERENCES products(id),
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  payload_hash TEXT NOT NULL,
  target_revisions_json TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  operation_marker TEXT NOT NULL UNIQUE,
  CONSTRAINT actions_payload_json_valid CHECK (json_valid(payload_json)),
  CONSTRAINT actions_target_revisions_json_valid CHECK (json_valid(target_revisions_json)),
  CONSTRAINT actions_workspace_kind CHECK (product_id IS NOT NULL OR kind = 'notion_publish')
);
INSERT INTO actions_workspace_upgrade SELECT * FROM actions;
DROP TABLE actions;
ALTER TABLE actions_workspace_upgrade RENAME TO actions;`,
  `CREATE TABLE actions_workspace_upgrade (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT REFERENCES products(id),
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  payload_hash TEXT NOT NULL,
  target_revisions_json TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  operation_marker TEXT NOT NULL UNIQUE,
  CONSTRAINT actions_payload_json_valid CHECK (json_valid(payload_json)),
  CONSTRAINT actions_target_revisions_json_valid CHECK (json_valid(target_revisions_json)),
  CONSTRAINT actions_workspace_kind CHECK (product_id IS NOT NULL OR kind IN ('notion_publish','github_issue'))
);
INSERT INTO actions_workspace_upgrade SELECT * FROM actions;
DROP TABLE actions;
ALTER TABLE actions_workspace_upgrade RENAME TO actions;`,
] as const;
