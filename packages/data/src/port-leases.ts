import type Database from "better-sqlite3";

export interface PortLease {
  port: number;
  task: { kind: string; id: string };
  leasedAt: string;
}

interface Row {
  port: number;
  task_kind: string;
  task_id: string;
  leased_at: string;
}

const toLease = (row: Row): PortLease => ({
  port: row.port,
  task: { kind: row.task_kind, id: row.task_id },
  leasedAt: row.leased_at,
});

/**
 * Gives each task its own port from a fixed range. The primary key on the
 * port and the unique key on the task make a double allocation impossible,
 * even across processes sharing the database.
 */
export class PortLeases {
  private readonly db: Database.Database;
  private readonly first: number;
  private readonly last: number;
  constructor(db: Database.Database, range = { first: 4100, last: 4999 }) {
    if (
      !Number.isInteger(range.first) ||
      !Number.isInteger(range.last) ||
      range.first < 1024 ||
      range.last > 65535 ||
      range.first > range.last
    )
      throw Error("Invalid port range");
    this.db = db;
    this.first = range.first;
    this.last = range.last;
  }

  /**
   * Returns the task's port, allocating the lowest free one the first time.
   * `inUse` lets the caller skip ports another program already holds.
   */
  lease(
    task: { kind: string; id: string },
    inUse: (port: number) => boolean = () => false,
  ): PortLease {
    if (!task.kind.trim() || !task.id.trim()) throw Error("Invalid task");
    return this.db
      .transaction(() => {
        const existing = this.forTask(task);
        if (existing) return existing;
        const taken = new Set(
          (
            this.db.prepare("SELECT port FROM port_leases").all() as {
              port: number;
            }[]
          ).map((row) => row.port),
        );
        for (let port = this.first; port <= this.last; port++) {
          if (taken.has(port) || inUse(port)) continue;
          this.db
            .prepare(
              "INSERT INTO port_leases(port,task_kind,task_id,leased_at) VALUES (?,?,?,?)",
            )
            .run(port, task.kind, task.id, new Date().toISOString());
          return this.forTask(task)!;
        }
        throw Error(`No free port between ${this.first} and ${this.last}`);
      })
      .immediate();
  }

  forTask(task: { kind: string; id: string }): PortLease | null {
    const row = this.db
      .prepare("SELECT * FROM port_leases WHERE task_kind=? AND task_id=?")
      .get(task.kind, task.id) as Row | undefined;
    return row ? toLease(row) : null;
  }

  /** Returns the task's port to the pool. Returns the port that was freed. */
  release(task: { kind: string; id: string }): number | null {
    const lease = this.forTask(task);
    if (!lease) return null;
    this.db.prepare("DELETE FROM port_leases WHERE port=?").run(lease.port);
    return lease.port;
  }

  leases(): PortLease[] {
    return (
      this.db.prepare("SELECT * FROM port_leases ORDER BY port").all() as Row[]
    ).map(toLease);
  }
}
