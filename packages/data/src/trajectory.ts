import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { Redactor } from "../../security/src/redaction.ts";
import {
  compareReplay,
  filterEvents,
  resumeBrief,
  summarizeBranch,
  trajectorySources,
  type BranchSummary,
  type ReplayComparison,
  type ReplayMode,
  type ResumeBrief,
  type TrajectoryEvent,
  type TrajectoryFilter,
  type TrajectorySource,
} from "../../domain/src/trajectory.ts";

export interface TrajectorySession {
  id: string;
  productId: string | null;
  title: string;
  origin: string;
  runId: string | null;
  parentId: string | null;
  forkSeq: number | null;
  replayOf: string | null;
  replayMode: ReplayMode | null;
  createdAt: string;
}

export interface AppendInput {
  source: TrajectorySource;
  kind: string;
  participant: string;
  summary: string;
  detail?: unknown;
  refersTo?: string;
  status?: string;
  tool?: string;
  costMicros?: number;
  durationMs?: number;
  /** Keep the summary but withhold the detail from the visible record. */
  confidential?: boolean;
  at?: string;
}

interface SessionRow {
  id: string;
  product_id: string | null;
  title: string;
  origin: string;
  run_id: string | null;
  parent_id: string | null;
  fork_seq: number | null;
  replay_of: string | null;
  replay_mode: ReplayMode | null;
  created_at: string;
}

interface EventRow {
  session_id: string;
  seq: number;
  id: string;
  at: string;
  source: TrajectorySource;
  kind: string;
  participant: string;
  summary: string;
  detail_json: string;
  refers_to: string | null;
  status: string | null;
  tool: string | null;
  cost_micros: number | null;
  duration_ms: number | null;
  prev_hash: string;
  hash: string;
}

const label = /^[a-z][a-z0-9_.-]{0,63}$/;

function bounded(value: number | undefined, name: string): number | null {
  if (value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0)
    throw Error("Invalid trajectory " + name);
  return value;
}

function digest(previous: string, row: Omit<EventRow, "hash">): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        previous,
        row.session_id,
        row.seq,
        row.id,
        row.at,
        row.source,
        row.kind,
        row.participant,
        row.summary,
        row.detail_json,
        row.refers_to,
        row.status,
        row.tool,
        row.cost_micros,
        row.duration_ms,
      ]),
    )
    .digest("hex");
}

function toSession(row: SessionRow): TrajectorySession {
  return {
    id: row.id,
    productId: row.product_id,
    title: row.title,
    origin: row.origin,
    runId: row.run_id,
    parentId: row.parent_id,
    forkSeq: row.fork_seq,
    replayOf: row.replay_of,
    replayMode: row.replay_mode,
    createdAt: row.created_at,
  };
}

function toEvent(row: EventRow): TrajectoryEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    seq: row.seq,
    at: row.at,
    source: row.source,
    kind: row.kind,
    participant: row.participant,
    summary: row.summary,
    detail: JSON.parse(row.detail_json) as unknown,
    refersTo: row.refers_to,
    status: row.status,
    tool: row.tool,
    costMicros: row.cost_micros,
    durationMs: row.duration_ms,
  };
}

/**
 * Append-only record of agent sessions. Events are redacted before they are
 * stored, chained by hash so tampering is detectable, and never updated or
 * deleted: a correction is a new event that refers to the original.
 */
export class Trajectory {
  private readonly db: Database.Database;
  private readonly redactor: Redactor;
  constructor(db: Database.Database, redactor: Redactor = new Redactor()) {
    this.db = db;
    this.redactor = redactor;
  }

  start(input: {
    title: string;
    origin: string;
    productId?: string;
    runId?: string;
  }): TrajectorySession {
    return this.insertSession({
      title: input.title,
      origin: input.origin,
      productId: input.productId ?? null,
      runId: input.runId ?? null,
      parentId: null,
      forkSeq: null,
      replayOf: null,
      replayMode: null,
    });
  }

  session(id: string): TrajectorySession {
    const row = this.db
      .prepare("SELECT * FROM trajectory_sessions WHERE id=?")
      .get(id) as SessionRow | undefined;
    if (!row) throw Error("Unknown trajectory session");
    return toSession(row);
  }

  sessions(productId?: string): TrajectorySession[] {
    const rows = (
      productId === undefined
        ? this.db
            .prepare(
              "SELECT * FROM trajectory_sessions ORDER BY created_at,rowid",
            )
            .all()
        : this.db
            .prepare(
              "SELECT * FROM trajectory_sessions WHERE product_id=? ORDER BY created_at,rowid",
            )
            .all(productId)
    ) as SessionRow[];
    return rows.map(toSession);
  }

  /** Adds one event to the end of a session and returns it as stored. */
  append(sessionId: string, input: AppendInput): TrajectoryEvent {
    if (!trajectorySources.includes(input.source))
      throw Error("Unknown trajectory source");
    if (!label.test(input.kind)) throw Error("Invalid trajectory event kind");
    if (!input.participant.trim() || input.participant.length > 128)
      throw Error("Invalid trajectory participant");
    if (!input.summary.trim() || input.summary.length > 4096)
      throw Error("A trajectory event needs a short summary");
    const detail = input.confidential
      ? { withheld: true, reason: "confidential" }
      : this.redactor.clean(input.detail ?? {});
    const detailJson = JSON.stringify(detail);
    if (detailJson.length > 262144)
      throw Error("Trajectory event detail is too large");
    return this.db
      .transaction(() => {
        const session = this.session(sessionId);
        if (
          input.refersTo !== undefined &&
          !this.visibleRows(session).some((row) => row.id === input.refersTo)
        )
          throw Error("A trajectory event can only refer to its own history");
        const last = this.db
          .prepare(
            "SELECT seq,hash FROM trajectory_events WHERE session_id=? ORDER BY seq DESC LIMIT 1",
          )
          .get(sessionId) as { seq: number; hash: string } | undefined;
        const previous = last?.hash ?? this.inheritedHash(session);
        const row: Omit<EventRow, "hash"> = {
          session_id: sessionId,
          seq: (last?.seq ?? 0) + 1,
          id: randomUUID(),
          at: input.at ?? new Date().toISOString(),
          source: input.source,
          kind: input.kind,
          participant: this.redactor.text(input.participant),
          summary: this.redactor.text(input.summary),
          detail_json: detailJson,
          refers_to: input.refersTo ?? null,
          status: input.status ?? null,
          tool: input.tool ?? null,
          cost_micros: bounded(input.costMicros, "cost"),
          duration_ms: bounded(input.durationMs, "duration"),
          prev_hash: previous,
        };
        const stored: EventRow = { ...row, hash: digest(previous, row) };
        this.db
          .prepare(
            `INSERT INTO trajectory_events(session_id,seq,id,at,source,kind,participant,summary,detail_json,refers_to,status,tool,cost_micros,duration_ms,prev_hash,hash)
             VALUES (@session_id,@seq,@id,@at,@source,@kind,@participant,@summary,@detail_json,@refers_to,@status,@tool,@cost_micros,@duration_ms,@prev_hash,@hash)`,
          )
          .run(stored);
        return toEvent(stored);
      })
      .immediate();
  }

  /** The full history a session can see: inherited events, then its own. */
  events(sessionId: string, filter: TrajectoryFilter = {}): TrajectoryEvent[] {
    return filterEvents(
      this.visibleRows(this.session(sessionId)).map(toEvent),
      filter,
    );
  }

  /** Searches one session, or every session of a product, newest last. */
  search(
    filter: TrajectoryFilter,
    scope: { sessionId: string } | { productId: string },
  ): TrajectoryEvent[] {
    if ("sessionId" in scope) return this.events(scope.sessionId, filter);
    const rows = this.db
      .prepare(
        `SELECT e.* FROM trajectory_events e JOIN trajectory_sessions s ON s.id=e.session_id
         WHERE s.product_id=? ORDER BY e.at,s.rowid,e.seq`,
      )
      .all(scope.productId) as EventRow[];
    return filterEvents(rows.map(toEvent), filter);
  }

  resume(sessionId: string): ResumeBrief {
    return resumeBrief(this.events(sessionId));
  }

  /**
   * Branches from an event the session can see. The original is untouched;
   * the branch inherits history up to that event and records its own after.
   */
  fork(sessionId: string, eventId: string, title: string): TrajectorySession {
    const parent = this.session(sessionId);
    const own = this.db
      .prepare("SELECT seq FROM trajectory_events WHERE session_id=? AND id=?")
      .get(sessionId, eventId) as { seq: number } | undefined;
    if (!own) throw Error("Fork from an event recorded in this session");
    return this.insertSession({
      title,
      origin: parent.origin,
      productId: parent.productId,
      runId: null,
      parentId: parent.id,
      forkSeq: own.seq,
      replayOf: null,
      replayMode: null,
    });
  }

  /** The first session of a family of branches. */
  root(sessionId: string): TrajectorySession {
    let session = this.session(sessionId);
    while (session.parentId) session = this.session(session.parentId);
    return session;
  }

  /** A session's root and every branch that descends from it. */
  branches(sessionId: string): TrajectorySession[] {
    const root = this.root(sessionId);
    const rows = this.db
      .prepare(
        `WITH RECURSIVE family(id) AS (
           SELECT ? UNION ALL
           SELECT s.id FROM trajectory_sessions s JOIN family f ON s.parent_id=f.id
         )
         SELECT s.* FROM trajectory_sessions s JOIN family f ON f.id=s.id ORDER BY s.created_at,s.rowid`,
      )
      .all(root.id) as SessionRow[];
    return rows.map(toSession);
  }

  compareBranches(sessionId: string): (BranchSummary & {
    title: string;
    preferred: boolean;
  })[] {
    const preferred = this.preferred(sessionId);
    return this.branches(sessionId).map((branch) => ({
      ...summarizeBranch(branch.id, this.events(branch.id)),
      title: branch.title,
      preferred: branch.id === preferred,
    }));
  }

  /** Marks one branch as the preferred path. The others are kept. */
  promote(sessionId: string): void {
    const root = this.root(sessionId);
    this.db
      .prepare(
        `INSERT INTO trajectory_preferred(root_id,session_id,chosen_at) VALUES (?,?,?)
         ON CONFLICT(root_id) DO UPDATE SET session_id=excluded.session_id, chosen_at=excluded.chosen_at`,
      )
      .run(root.id, sessionId, new Date().toISOString());
  }

  /** The preferred branch of a family; the root until one is promoted. */
  preferred(sessionId: string): string {
    const root = this.root(sessionId);
    const row = this.db
      .prepare("SELECT session_id FROM trajectory_preferred WHERE root_id=?")
      .get(root.id) as { session_id: string } | undefined;
    return row?.session_id ?? root.id;
  }

  /**
   * Opens a replay of a session. A reconstruction copies the stored record so
   * it can be stepped through; a re-execution starts empty and is filled by a
   * new run, whose results may differ.
   */
  replay(sessionId: string, mode: ReplayMode): TrajectorySession {
    const original = this.session(sessionId);
    return this.db
      .transaction(() => {
        const replay = this.insertSession({
          title: "Replay of " + original.title,
          origin: original.origin,
          productId: original.productId,
          runId: null,
          parentId: null,
          forkSeq: null,
          replayOf: original.id,
          replayMode: mode,
        });
        if (mode === "reconstruction") {
          const ids = new Map<string, string>();
          for (const event of this.events(sessionId)) {
            const copy = this.append(replay.id, {
              source: event.source,
              kind: event.kind,
              participant: event.participant,
              summary: event.summary,
              detail: event.detail,
              at: event.at,
              ...(event.refersTo !== null && ids.has(event.refersTo)
                ? { refersTo: ids.get(event.refersTo)! }
                : {}),
              ...(event.status !== null ? { status: event.status } : {}),
              ...(event.tool !== null ? { tool: event.tool } : {}),
              ...(event.costMicros !== null
                ? { costMicros: event.costMicros }
                : {}),
              ...(event.durationMs !== null
                ? { durationMs: event.durationMs }
                : {}),
            });
            ids.set(event.id, copy.id);
          }
        }
        return replay;
      })
      .immediate();
  }

  /** What differs between a replay and the session it replays. */
  replayComparison(
    replayId: string,
    conditions?: Parameters<typeof compareReplay>[3],
  ): ReplayComparison {
    const replay = this.session(replayId);
    if (!replay.replayOf || !replay.replayMode)
      throw Error("This session is not a replay");
    return compareReplay(
      replay.replayMode,
      this.events(replay.replayOf),
      this.events(replayId),
      conditions,
    );
  }

  /** Recomputes the hash chain. False means stored events were altered. */
  verify(sessionId: string): boolean {
    const session = this.session(sessionId);
    const rows = this.db
      .prepare(
        "SELECT * FROM trajectory_events WHERE session_id=? ORDER BY seq",
      )
      .all(sessionId) as EventRow[];
    let previous = this.inheritedHash(session);
    return rows.every((row, index) => {
      const { hash, ...rest } = row;
      const valid =
        row.seq === index + 1 &&
        row.prev_hash === previous &&
        hash === digest(previous, rest);
      previous = hash;
      return valid;
    });
  }

  private inheritedHash(session: TrajectorySession): string {
    if (!session.parentId || session.forkSeq === null) return "";
    const row = this.db
      .prepare(
        "SELECT hash FROM trajectory_events WHERE session_id=? AND seq=?",
      )
      .get(session.parentId, session.forkSeq) as { hash: string } | undefined;
    if (!row) throw Error("Fork point is missing from the parent session");
    return row.hash;
  }

  private visibleRows(session: TrajectorySession): EventRow[] {
    const chain: { id: string; upTo: number | null }[] = [];
    let current: TrajectorySession | null = session;
    let limit: number | null = null;
    while (current) {
      chain.unshift({ id: current.id, upTo: limit });
      limit = current.forkSeq;
      current = current.parentId ? this.session(current.parentId) : null;
    }
    return chain.flatMap(
      ({ id, upTo }) =>
        this.db
          .prepare(
            "SELECT * FROM trajectory_events WHERE session_id=? AND seq<=? ORDER BY seq",
          )
          .all(id, upTo ?? Number.MAX_SAFE_INTEGER) as EventRow[],
    );
  }

  private insertSession(
    input: Omit<TrajectorySession, "id" | "createdAt">,
  ): TrajectorySession {
    if (!input.title.trim() || input.title.length > 256)
      throw Error("A trajectory session needs a title");
    if (!label.test(input.origin)) throw Error("Invalid trajectory origin");
    const session: TrajectorySession = {
      ...input,
      title: this.redactor.text(input.title),
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO trajectory_sessions(id,product_id,title,origin,run_id,parent_id,fork_seq,replay_of,replay_mode,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        session.id,
        session.productId,
        session.title,
        session.origin,
        session.runId,
        session.parentId,
        session.forkSeq,
        session.replayOf,
        session.replayMode,
        session.createdAt,
      );
    return session;
  }
}
