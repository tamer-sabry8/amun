import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BacklogRecord, BoardColumn } from "@getpaseo/protocol/amun-rpc";
import { boardColumnFor } from "./firstmate-cli.js";

/** $FM_HOME/data/amun-pm.db: Amun-only PM records. data/backlog.md stays Firstmate's. */
export function pmDatabasePath(fmHome: string): string {
  return path.join(fmHome, "data", "amun-pm.db");
}

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS roadmaps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  horizon TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS initiatives (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  what TEXT,
  why TEXT,
  when_text TEXT,
  cost TEXT,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'in_delivery', 'shipped', 'dropped')),
  roadmap_id TEXT REFERENCES roadmaps(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('future', 'active', 'closed')),
  starts_at TEXT,
  ends_at TEXT,
  source TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local', 'jira', 'linear')),
  external_id TEXT,
  UNIQUE (source, external_id)
);
CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  kind TEXT,
  board_column TEXT NOT NULL
    CHECK (board_column IN ('backlog', 'discovery', 'spec', 'in_progress', 'review', 'done')),
  initiative_id TEXT REFERENCES initiatives(id) ON DELETE SET NULL,
  sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL,
  backlog_task_id TEXT UNIQUE,
  points REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS external_links (
  story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  system TEXT NOT NULL CHECK (system IN ('linear', 'jira')),
  account TEXT NOT NULL,
  external_id TEXT NOT NULL,
  external_key TEXT,
  remote_status TEXT,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (story_id, system),
  UNIQUE (system, account, external_id)
);
`;

export interface Initiative {
  id: string;
  title: string;
  what: string | null;
  why: string | null;
  when: string | null;
  cost: string | null;
  status: "proposed" | "approved" | "in_delivery" | "shipped" | "dropped";
  roadmapId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FourQuestion = "what" | "why" | "when" | "cost";
export const FOUR_QUESTIONS: readonly FourQuestion[] = ["what", "why", "when", "cost"];

export interface Story {
  id: string;
  title: string;
  body: string;
  kind: string | null;
  column: BoardColumn;
  initiativeId: string | null;
  sprintId: string | null;
  backlogTaskId: string | null;
  points: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Sprint {
  id: string;
  name: string;
  state: "future" | "active" | "closed";
  startsAt: string | null;
  endsAt: string | null;
  source: "local" | "jira" | "linear";
  externalId: string | null;
}

export interface ExternalLink {
  storyId: string;
  system: "linear" | "jira";
  account: string;
  externalId: string;
  externalKey: string | null;
  remoteStatus: string | null;
  syncedAt: string;
}

export interface ProjectionResult {
  created: string[];
  moved: { id: string; from: BoardColumn; to: BoardColumn }[];
  unchanged: number;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string => String(v);
const opt = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function toInitiative(r: Row): Initiative {
  return {
    id: str(r.id),
    title: str(r.title),
    what: opt(r.what),
    why: opt(r.why),
    when: opt(r.when_text),
    cost: opt(r.cost),
    status: str(r.status) as Initiative["status"],
    roadmapId: opt(r.roadmap_id),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

function toStory(r: Row): Story {
  return {
    id: str(r.id),
    title: str(r.title),
    body: str(r.body),
    kind: opt(r.kind),
    column: str(r.board_column) as BoardColumn,
    initiativeId: opt(r.initiative_id),
    sprintId: opt(r.sprint_id),
    backlogTaskId: opt(r.backlog_task_id),
    points: r.points === null || r.points === undefined ? null : Number(r.points),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

function toSprint(r: Row): Sprint {
  return {
    id: str(r.id),
    name: str(r.name),
    state: str(r.state) as Sprint["state"],
    startsAt: opt(r.starts_at),
    endsAt: opt(r.ends_at),
    source: str(r.source) as Sprint["source"],
    externalId: opt(r.external_id),
  };
}

export class PmStore {
  private readonly db: DatabaseSync;

  constructor(
    file: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
    const meta = this.db.prepare("SELECT version FROM schema_meta").get();
    if (!meta) this.db.prepare("INSERT INTO schema_meta (version) VALUES (?)").run(SCHEMA_VERSION);
  }

  static forHome(fmHome: string): PmStore {
    return new PmStore(pmDatabasePath(fmHome));
  }

  close(): void {
    this.db.close();
  }

  private stamp(): string {
    return this.now().toISOString();
  }

  // --- Roadmaps and initiatives (4-Question Framework) -------------------------

  createRoadmap(input: { id: string; name: string; horizon?: string }): void {
    this.db
      .prepare("INSERT INTO roadmaps (id, name, horizon, created_at) VALUES (?, ?, ?, ?)")
      .run(input.id, input.name, input.horizon ?? null, this.stamp());
  }

  upsertInitiative(
    input: { id: string; title: string } & Partial<
      Pick<Initiative, FourQuestion | "status" | "roadmapId">
    >,
  ): Initiative {
    const at = this.stamp();
    const existing = this.getInitiative(input.id);
    const merged = {
      what: input.what ?? existing?.what ?? null,
      why: input.why ?? existing?.why ?? null,
      when: input.when ?? existing?.when ?? null,
      cost: input.cost ?? existing?.cost ?? null,
      status: input.status ?? existing?.status ?? "proposed",
      roadmapId: input.roadmapId ?? existing?.roadmapId ?? null,
    };
    this.db
      .prepare(
        `INSERT INTO initiatives (id, title, what, why, when_text, cost, status, roadmap_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, what = excluded.what, why = excluded.why,
           when_text = excluded.when_text, cost = excluded.cost, status = excluded.status,
           roadmap_id = excluded.roadmap_id, updated_at = excluded.updated_at`,
      )
      .run(
        input.id,
        input.title,
        merged.what,
        merged.why,
        merged.when,
        merged.cost,
        merged.status,
        merged.roadmapId,
        existing?.createdAt ?? at,
        at,
      );
    return this.getInitiative(input.id)!;
  }

  getInitiative(id: string): Initiative | null {
    const row = this.db.prepare("SELECT * FROM initiatives WHERE id = ?").get(id) as Row | undefined;
    return row ? toInitiative(row) : null;
  }

  listInitiatives(roadmapId?: string): Initiative[] {
    const rows = roadmapId
      ? this.db.prepare("SELECT * FROM initiatives WHERE roadmap_id = ? ORDER BY created_at").all(roadmapId)
      : this.db.prepare("SELECT * FROM initiatives ORDER BY created_at").all();
    return (rows as Row[]).map(toInitiative);
  }

  /** Which of the four mandatory questions are still unanswered. */
  static missingQuestions(initiative: Initiative): FourQuestion[] {
    return FOUR_QUESTIONS.filter((q) => !initiative[q] || initiative[q]!.trim() === "");
  }

  // --- Sprints ------------------------------------------------------------------

  upsertSprint(sprint: Sprint): void {
    this.db
      .prepare(
        `INSERT INTO sprints (id, name, state, starts_at, ends_at, source, external_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, state = excluded.state,
           starts_at = excluded.starts_at, ends_at = excluded.ends_at`,
      )
      .run(
        sprint.id,
        sprint.name,
        sprint.state,
        sprint.startsAt,
        sprint.endsAt,
        sprint.source,
        sprint.externalId,
      );
  }

  listSprints(): Sprint[] {
    return (this.db.prepare("SELECT * FROM sprints ORDER BY starts_at, id").all() as Row[]).map(toSprint);
  }

  // --- Stories ------------------------------------------------------------------

  upsertStory(
    input: { id: string; title: string; column: BoardColumn } & Partial<
      Pick<Story, "body" | "kind" | "initiativeId" | "sprintId" | "backlogTaskId" | "points">
    >,
  ): Story {
    const at = this.stamp();
    const existing = this.getStory(input.id);
    this.db
      .prepare(
        `INSERT INTO stories (id, title, body, kind, board_column, initiative_id, sprint_id, backlog_task_id, points, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body, kind = excluded.kind,
           board_column = excluded.board_column, initiative_id = excluded.initiative_id,
           sprint_id = excluded.sprint_id, backlog_task_id = excluded.backlog_task_id,
           points = excluded.points, updated_at = excluded.updated_at`,
      )
      .run(
        input.id,
        input.title,
        input.body ?? existing?.body ?? "",
        input.kind ?? existing?.kind ?? null,
        input.column,
        input.initiativeId ?? existing?.initiativeId ?? null,
        input.sprintId ?? existing?.sprintId ?? null,
        input.backlogTaskId ?? existing?.backlogTaskId ?? null,
        input.points ?? existing?.points ?? null,
        existing?.createdAt ?? at,
        at,
      );
    return this.getStory(input.id)!;
  }

  getStory(id: string): Story | null {
    const row = this.db.prepare("SELECT * FROM stories WHERE id = ?").get(id) as Row | undefined;
    return row ? toStory(row) : null;
  }

  storyForBacklogTask(taskId: string): Story | null {
    const row = this.db.prepare("SELECT * FROM stories WHERE backlog_task_id = ?").get(taskId) as
      | Row
      | undefined;
    return row ? toStory(row) : null;
  }

  board(): Record<BoardColumn, Story[]> {
    const board: Record<BoardColumn, Story[]> = {
      backlog: [],
      discovery: [],
      spec: [],
      in_progress: [],
      review: [],
      done: [],
    };
    for (const row of this.db.prepare("SELECT * FROM stories ORDER BY created_at, id").all() as Row[]) {
      const story = toStory(row);
      board[story.column].push(story);
    }
    return board;
  }

  /**
   * Mirror Firstmate's backlog onto the board. Firstmate's lifecycle
   * (fm-spawn.sh -> start, fm-teardown.sh -> done) is the writer; this only
   * follows it. Rows pruned out of backlog.md keep their last column.
   */
  projectBacklog(records: BacklogRecord[]): ProjectionResult {
    const result: ProjectionResult = { created: [], moved: [], unchanged: 0 };
    this.db.exec("BEGIN");
    try {
      for (const record of records) {
        if (!record.id || record.structured === false) continue;
        const column = boardColumnFor(record);
        const existing = this.storyForBacklogTask(record.id);
        if (!existing) {
          this.upsertStory({
            id: record.id,
            title: record.title ?? record.id,
            column,
            kind: record.kind ?? null,
            backlogTaskId: record.id,
          });
          result.created.push(record.id);
        } else if (existing.column !== column || existing.title !== (record.title ?? existing.title)) {
          this.upsertStory({ ...existing, title: record.title ?? existing.title, column });
          if (existing.column !== column) result.moved.push({ id: existing.id, from: existing.column, to: column });
          else result.unchanged += 1;
        } else {
          result.unchanged += 1;
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return result;
  }

  // --- External links (Linear / Jira) ---------------------------------------------

  linkExternal(link: ExternalLink): void {
    this.db
      .prepare(
        `INSERT INTO external_links (story_id, system, account, external_id, external_key, remote_status, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(story_id, system) DO UPDATE SET account = excluded.account, external_id = excluded.external_id,
           external_key = excluded.external_key, remote_status = excluded.remote_status, synced_at = excluded.synced_at`,
      )
      .run(
        link.storyId,
        link.system,
        link.account,
        link.externalId,
        link.externalKey,
        link.remoteStatus,
        link.syncedAt,
      );
  }

  externalLinks(storyId: string): ExternalLink[] {
    const rows = this.db.prepare("SELECT * FROM external_links WHERE story_id = ?").all(storyId) as Row[];
    return rows.map((r) => ({
      storyId: str(r.story_id),
      system: str(r.system) as ExternalLink["system"],
      account: str(r.account),
      externalId: str(r.external_id),
      externalKey: opt(r.external_key),
      remoteStatus: opt(r.remote_status),
      syncedAt: str(r.synced_at),
    }));
  }

  storyForExternal(system: ExternalLink["system"], account: string, externalId: string): Story | null {
    const row = this.db
      .prepare(
        `SELECT s.* FROM stories s JOIN external_links l ON l.story_id = s.id
         WHERE l.system = ? AND l.account = ? AND l.external_id = ?`,
      )
      .get(system, account, externalId) as Row | undefined;
    return row ? toStory(row) : null;
  }
}
