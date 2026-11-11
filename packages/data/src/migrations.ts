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
  `CREATE TABLE notion_delivery (
    action_id TEXT PRIMARY KEY REFERENCES actions(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('not sent','sent-unknown','confirmed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    check_after INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO notion_delivery(action_id,state)
    SELECT id,CASE WHEN state='succeeded' THEN 'confirmed' WHEN state IN ('executing','unknown') THEN 'sent-unknown' ELSE 'not sent' END FROM actions WHERE kind='notion_publish';
  CREATE TRIGGER notion_intent_after_insert AFTER INSERT ON actions WHEN NEW.kind='notion_publish'
    BEGIN INSERT INTO notion_delivery(action_id,state) VALUES(NEW.id,'not sent'); END;
  CREATE TRIGGER notion_confirm_after_update AFTER UPDATE OF state ON actions WHEN NEW.kind='notion_publish' AND NEW.state='succeeded'
    BEGIN UPDATE notion_delivery SET state='confirmed' WHERE action_id=NEW.id; END;
  CREATE INDEX notion_delivery_due ON notion_delivery(state, check_after);`,
  `CREATE TABLE source_documents (
    source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
    body TEXT NOT NULL, image BLOB
  );`,
  `CREATE TABLE product_interviews(request_id TEXT PRIMARY KEY REFERENCES attention_items(id), objective_id TEXT NOT NULL REFERENCES objectives(id), model TEXT NOT NULL, context_json TEXT NOT NULL CHECK(json_valid(context_json)));`,
  `CREATE TABLE product_understandings(objective_id TEXT NOT NULL REFERENCES objectives(id),version INTEGER NOT NULL,facts TEXT NOT NULL,assumptions TEXT NOT NULL,questions TEXT NOT NULL,approved INTEGER NOT NULL CHECK(approved IN (0,1)),PRIMARY KEY(objective_id,version));`,
  `CREATE TABLE prd_proposals(id TEXT PRIMARY KEY,objective_id TEXT NOT NULL REFERENCES objectives(id),base_version INTEGER NOT NULL,understanding_version INTEGER NOT NULL,model TEXT NOT NULL,context_json TEXT NOT NULL,markdown TEXT NOT NULL,rationale TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('pending','applied','dismissed','stale')));
  CREATE UNIQUE INDEX one_pending_prd_proposal ON prd_proposals(objective_id) WHERE state='pending';`,
  `CREATE TABLE priorities(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),objective TEXT NOT NULL,release TEXT NOT NULL,status TEXT NOT NULL,evidence TEXT NOT NULL,reach INTEGER,impact REAL,confidence REAL,effort REAL);`,
  `CREATE TABLE prd_selections(id TEXT PRIMARY KEY,objective_id TEXT NOT NULL REFERENCES objectives(id),version INTEGER NOT NULL,intent TEXT NOT NULL,selection TEXT NOT NULL,target TEXT NOT NULL,UNIQUE(objective_id,version,intent,selection));`,
  `CREATE TABLE story_drafts(item_id TEXT PRIMARY KEY REFERENCES work_items(id), objective_id TEXT NOT NULL REFERENCES objectives(id), prd_version INTEGER NOT NULL, requirement_id TEXT NOT NULL, requirement_text TEXT NOT NULL);
 CREATE INDEX story_drafts_revision ON story_drafts(objective_id,prd_version);`,
  `CREATE TABLE story_decisions(request_id TEXT PRIMARY KEY REFERENCES attention_items(id),item_id TEXT NOT NULL REFERENCES work_items(id),requirement_id TEXT NOT NULL,options_json TEXT NOT NULL,proposed TEXT NOT NULL,missing TEXT NOT NULL,choice TEXT NOT NULL DEFAULT '',confirmation TEXT NOT NULL DEFAULT '',requested INTEGER NOT NULL DEFAULT 0);`,
  `CREATE TABLE ado_batches(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),kind TEXT NOT NULL,destination_json TEXT NOT NULL,binding TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE ado_steps(batch_id TEXT NOT NULL REFERENCES ado_batches(id),ordinal INTEGER NOT NULL,item_id TEXT NOT NULL,action_id TEXT NOT NULL UNIQUE REFERENCES actions(id),remote_id INTEGER,remote_rev INTEGER,PRIMARY KEY(batch_id,ordinal));`,
  `CREATE TABLE firstmate_chat(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),model TEXT NOT NULL,selection TEXT,text TEXT NOT NULL,reply TEXT,state TEXT NOT NULL CHECK(state IN ('working','answered','interrupted')));
CREATE INDEX chat_product ON firstmate_chat(product_id);`,
  `CREATE TABLE model_routes(product_id TEXT NOT NULL REFERENCES products(id),task TEXT NOT NULL,difficulty TEXT NOT NULL,model TEXT NOT NULL,PRIMARY KEY(product_id,task,difficulty));`,
  `CREATE TABLE delivery_acceptance(id TEXT PRIMARY KEY,action_id TEXT NOT NULL REFERENCES actions(id),story_id TEXT NOT NULL REFERENCES work_items(id),verdict TEXT NOT NULL CHECK(verdict IN ('Accepted','Rejected','Blocked')),rationale TEXT NOT NULL,checklist TEXT NOT NULL,at TEXT NOT NULL);`,
  `CREATE TABLE delivery_pull_requests(run_id TEXT PRIMARY KEY REFERENCES runs(id),repo TEXT NOT NULL,number INTEGER NOT NULL,head TEXT NOT NULL);
CREATE INDEX delivery_pull_identity ON delivery_pull_requests(repo,number,head);
CREATE UNIQUE INDEX delivery_acceptance_submission ON delivery_acceptance(action_id,story_id,verdict,rationale,checklist);`,
  `CREATE TABLE prototype_runs(run_id TEXT PRIMARY KEY REFERENCES runs(id),objective TEXT NOT NULL REFERENCES objectives(id),version INTEGER NOT NULL,UNIQUE(objective,version));`,
  `CREATE TABLE portfolio_confirmations(evidence_key TEXT PRIMARY KEY NOT NULL);`,
  `CREATE TABLE notion_memory_fields(link_id TEXT PRIMARY KEY REFERENCES sync_links(id) ON DELETE CASCADE,product_id TEXT NOT NULL REFERENCES products(id),field TEXT NOT NULL,label TEXT NOT NULL,workspace_id TEXT,baseline TEXT,remote TEXT);
  CREATE UNIQUE INDEX notion_memory_field_mapping ON sync_links(local_ref, remote_id) WHERE remote_system='notion-memory';`,
  `ALTER TABLE personal_tasks ADD COLUMN product_id TEXT REFERENCES products(id);
  ALTER TABLE personal_tasks ADD COLUMN title TEXT;
  ALTER TABLE personal_tasks ADD COLUMN category TEXT;
  ALTER TABLE personal_tasks ADD COLUMN consequential INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX due_personal_tasks ON personal_tasks(state,due_at);`,
  `CREATE TABLE installed_skill_text(skill_id TEXT PRIMARY KEY REFERENCES skills(id),product_id TEXT NOT NULL REFERENCES products(id),source TEXT NOT NULL);`,
  `CREATE TABLE actions_portfolio_upgrade (
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
  CONSTRAINT actions_workspace_kind CHECK (product_id IS NOT NULL OR kind IN ('notion_publish','github_issue','publish'))
);
INSERT INTO actions_portfolio_upgrade SELECT * FROM actions;
DROP TABLE actions;
ALTER TABLE actions_portfolio_upgrade RENAME TO actions;
  CREATE TRIGGER notion_intent_after_insert AFTER INSERT ON actions WHEN NEW.kind='notion_publish'
    BEGIN INSERT INTO notion_delivery(action_id,state) VALUES(NEW.id,'not sent'); END;
  CREATE TRIGGER notion_confirm_after_update AFTER UPDATE OF state ON actions WHEN NEW.kind='notion_publish' AND NEW.state='succeeded'
    BEGIN UPDATE notion_delivery SET state='confirmed' WHERE action_id=NEW.id; END;
CREATE TABLE portfolio_exports(id TEXT PRIMARY KEY REFERENCES actions(id),path TEXT NOT NULL);`,
  `CREATE TABLE trajectory_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT REFERENCES products(id),
  title TEXT NOT NULL,
  origin TEXT NOT NULL,
  run_id TEXT,
  parent_id TEXT REFERENCES trajectory_sessions(id),
  fork_seq INTEGER,
  replay_of TEXT REFERENCES trajectory_sessions(id),
  replay_mode TEXT,
  created_at TEXT NOT NULL,
  CONSTRAINT trajectory_fork_complete CHECK ((parent_id IS NULL) = (fork_seq IS NULL)),
  CONSTRAINT trajectory_replay_complete CHECK ((replay_of IS NULL) = (replay_mode IS NULL)),
  CONSTRAINT trajectory_replay_mode CHECK (replay_mode IS NULL OR replay_mode IN ('reconstruction','re_execution'))
);
CREATE TABLE trajectory_events (
  session_id TEXT NOT NULL REFERENCES trajectory_sessions(id),
  seq INTEGER NOT NULL,
  id TEXT NOT NULL UNIQUE,
  at TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  participant TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  refers_to TEXT REFERENCES trajectory_events(id),
  status TEXT,
  tool TEXT,
  cost_micros INTEGER,
  duration_ms INTEGER,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY (session_id, seq),
  CONSTRAINT trajectory_events_detail_json_valid CHECK (json_valid(detail_json)),
  CONSTRAINT trajectory_events_source CHECK (source IN ('user','system','reasoning','tool','context','subagent','approval','error','outcome')),
  CONSTRAINT trajectory_events_seq CHECK (seq >= 1)
);
CREATE TRIGGER trajectory_events_no_update BEFORE UPDATE ON trajectory_events BEGIN SELECT RAISE(ABORT, 'Trajectory events are append-only'); END;
CREATE TRIGGER trajectory_events_no_delete BEFORE DELETE ON trajectory_events BEGIN SELECT RAISE(ABORT, 'Trajectory events are append-only'); END;
CREATE TRIGGER trajectory_sessions_no_delete BEFORE DELETE ON trajectory_sessions BEGIN SELECT RAISE(ABORT, 'Trajectory sessions are retained'); END;
CREATE TABLE trajectory_preferred (
  root_id TEXT PRIMARY KEY NOT NULL REFERENCES trajectory_sessions(id),
  session_id TEXT NOT NULL REFERENCES trajectory_sessions(id),
  chosen_at TEXT NOT NULL
);
CREATE TABLE agents (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  runtime TEXT NOT NULL,
  external_ref TEXT,
  accountable_owner TEXT,
  manager_id TEXT REFERENCES agents(id),
  status TEXT NOT NULL,
  scopes_json TEXT NOT NULL DEFAULT '{}',
  budget_micros INTEGER,
  budget_period TEXT,
  schedule_json TEXT NOT NULL DEFAULT '{}',
  escalation TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT agents_scopes_json_valid CHECK (json_valid(scopes_json)),
  CONSTRAINT agents_schedule_json_valid CHECK (json_valid(schedule_json)),
  CONSTRAINT agents_status CHECK (status IN ('active','paused','blocked','needs_attention','retired')),
  CONSTRAINT agents_budget CHECK ((budget_micros IS NULL) = (budget_period IS NULL) AND (budget_micros IS NULL OR budget_micros >= 0)),
  CONSTRAINT agents_budget_period CHECK (budget_period IS NULL OR budget_period IN ('day','week','month','total')),
  CONSTRAINT agents_accountable CHECK (accountable_owner IS NOT NULL OR manager_id IS NOT NULL)
);
CREATE TABLE agent_collaborators (
  agent_id TEXT NOT NULL REFERENCES agents(id),
  peer_id TEXT NOT NULL REFERENCES agents(id),
  PRIMARY KEY (agent_id, peer_id),
  CONSTRAINT agent_collaborators_ordered CHECK (agent_id < peer_id)
);
CREATE TABLE agent_assignments (
  agent_id TEXT NOT NULL REFERENCES agents(id),
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, target_kind, target_id),
  CONSTRAINT agent_assignments_kind CHECK (target_kind IN ('product','project','team','customer','workflow'))
);
CREATE TABLE agent_usage (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  at TEXT NOT NULL,
  micros INTEGER NOT NULL,
  ref TEXT,
  CONSTRAINT agent_usage_micros CHECK (micros >= 0)
);
CREATE TABLE goals (
  id TEXT PRIMARY KEY NOT NULL,
  parent_id TEXT REFERENCES goals(id),
  level TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  why TEXT NOT NULL DEFAULT '',
  beneficiaries TEXT NOT NULL DEFAULT '',
  success TEXT NOT NULL DEFAULT '',
  constraints_text TEXT NOT NULL DEFAULT '',
  rules_text TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CONSTRAINT goals_level CHECK (level IN ('goal','initiative','project','workstream')),
  CONSTRAINT goals_status CHECK (status IN ('active','achieved','paused','dropped')),
  CONSTRAINT goals_priority CHECK (priority BETWEEN 1 AND 5)
);
CREATE TABLE goal_links (
  goal_id TEXT NOT NULL REFERENCES goals(id),
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  contribution TEXT NOT NULL DEFAULT 'unassessed',
  note TEXT NOT NULL DEFAULT '',
  agent_id TEXT REFERENCES agents(id),
  linked_at TEXT NOT NULL,
  assessed_at TEXT,
  PRIMARY KEY (goal_id, target_kind, target_id),
  CONSTRAINT goal_links_kind CHECK (target_kind IN ('objective','work_item','run','session','artifact','decision')),
  CONSTRAINT goal_links_contribution CHECK (contribution IN ('unassessed','advanced','no_effect','set_back'))
);`,
  `CREATE TABLE task_claims (
  task_kind TEXT NOT NULL,
  task_id TEXT NOT NULL,
  holder_kind TEXT,
  holder_id TEXT,
  state TEXT NOT NULL,
  activity TEXT NOT NULL DEFAULT '',
  generation INTEGER NOT NULL DEFAULT 0,
  acquired_at TEXT,
  renewed_at TEXT,
  expires_at TEXT,
  PRIMARY KEY (task_kind, task_id),
  CONSTRAINT task_claims_state CHECK (state IN ('available','claimed','waiting_human','waiting_dependency','failed','paused','completed')),
  CONSTRAINT task_claims_holder_kind CHECK (holder_kind IS NULL OR holder_kind IN ('agent','human','team','service')),
  CONSTRAINT task_claims_holder CHECK ((holder_kind IS NULL) = (holder_id IS NULL)),
  CONSTRAINT task_claims_available_unheld CHECK (state <> 'available' OR holder_id IS NULL),
  CONSTRAINT task_claims_active_held CHECK (state NOT IN ('claimed','waiting_human','waiting_dependency') OR holder_id IS NOT NULL)
);
CREATE TABLE task_claim_events (
  id TEXT PRIMARY KEY NOT NULL,
  task_kind TEXT NOT NULL,
  task_id TEXT NOT NULL,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  event TEXT NOT NULL,
  holder TEXT,
  reason TEXT NOT NULL DEFAULT ''
);
CREATE TRIGGER task_claim_events_no_update BEFORE UPDATE ON task_claim_events BEGIN SELECT RAISE(ABORT, 'Claim history is append-only'); END;
CREATE TRIGGER task_claim_events_no_delete BEFORE DELETE ON task_claim_events BEGIN SELECT RAISE(ABORT, 'Claim history is append-only'); END;
CREATE TABLE agent_heartbeats (
  agent_id TEXT PRIMARY KEY NOT NULL REFERENCES agents(id),
  cadence_minutes INTEGER NOT NULL,
  next_at TEXT NOT NULL,
  max_wakes_per_hour INTEGER NOT NULL DEFAULT 12,
  max_consecutive_acts INTEGER NOT NULL DEFAULT 20,
  halted_reason TEXT,
  CONSTRAINT agent_heartbeats_cadence CHECK (cadence_minutes >= 1),
  CONSTRAINT agent_heartbeats_limits CHECK (max_wakes_per_hour >= 1 AND max_consecutive_acts >= 1)
);
CREATE TABLE agent_wakes (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  at TEXT NOT NULL,
  trigger_kind TEXT NOT NULL,
  reason TEXT NOT NULL,
  decision TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  waiting_on TEXT,
  next_at TEXT,
  objective_ref TEXT,
  counterpart_id TEXT,
  parent_wake_id TEXT REFERENCES agent_wakes(id),
  CONSTRAINT agent_wakes_trigger CHECK (trigger_kind IN ('assignment','message','blocker_resolved','schedule','business_event','human_request','delegation','escalation')),
  CONSTRAINT agent_wakes_decision CHECK (decision IN ('act','wait','delegate','escalate','request_approval','refused'))
);
CREATE TABLE plugins (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  origin TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  granted_hash TEXT,
  state TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT plugins_manifest_json_valid CHECK (json_valid(manifest_json)),
  CONSTRAINT plugins_kind CHECK (kind IN ('model_provider','connector','skill','workflow','interface','policy')),
  CONSTRAINT plugins_origin CHECK (origin IN ('first_party','customer','third_party')),
  CONSTRAINT plugins_state CHECK (state IN ('installed','enabled','disabled','removed')),
  CONSTRAINT plugins_enabled_granted CHECK (state <> 'enabled' OR (granted_hash IS NOT NULL AND granted_hash = manifest_hash))
);
CREATE TABLE element_feedback (
  id TEXT PRIMARY KEY NOT NULL,
  product_id TEXT REFERENCES products(id),
  thread_id TEXT NOT NULL,
  iteration INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  intent TEXT NOT NULL,
  purpose TEXT NOT NULL,
  capture_json TEXT NOT NULL,
  acknowledged_plan TEXT,
  after_json TEXT,
  verdict TEXT,
  CONSTRAINT element_feedback_capture_json_valid CHECK (json_valid(capture_json)),
  CONSTRAINT element_feedback_after_json_valid CHECK (after_json IS NULL OR json_valid(after_json)),
  CONSTRAINT element_feedback_verdict CHECK (verdict IS NULL OR verdict IN ('accepted','iterate')),
  CONSTRAINT element_feedback_iteration UNIQUE (thread_id, iteration)
);`,
] as const;
