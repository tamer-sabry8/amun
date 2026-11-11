import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export interface GitCheckpoint {
  id: string;
  repository: string;
  branch: string;
  operation: string;
  beforeSha: string;
  afterSha: string | null;
  createdAt: string;
  rolledBackAt: string | null;
}

interface Row {
  id: string;
  repository: string;
  branch: string;
  operation: string;
  before_sha: string;
  after_sha: string | null;
  created_at: string;
  rolled_back_at: string | null;
}

const toCheckpoint = (row: Row): GitCheckpoint => ({
  id: row.id,
  repository: row.repository,
  branch: row.branch,
  operation: row.operation,
  beforeSha: row.before_sha,
  afterSha: row.after_sha,
  createdAt: row.created_at,
  rolledBackAt: row.rolled_back_at,
});

const sha = /^[a-f0-9]{40,64}$/;

/** A record of where a branch was before each rebase, squash or resolution. */
export class GitCheckpoints {
  private readonly db: Database.Database;
  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Call before the operation, with the branch's current commit. */
  begin(
    repository: string,
    branch: string,
    operation: string,
    beforeSha: string,
  ): GitCheckpoint {
    if (!sha.test(beforeSha)) throw Error("Invalid commit id");
    if (!repository.trim() || !branch.trim() || !operation.trim())
      throw Error("A checkpoint needs a repository, a branch and an operation");
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO git_checkpoints(id,repository,branch,operation,before_sha,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        id,
        repository,
        branch,
        operation,
        beforeSha,
        new Date().toISOString(),
      );
    return this.get(id);
  }

  /** Call after the operation, with the commit it produced. */
  finish(id: string, afterSha: string): GitCheckpoint {
    if (!sha.test(afterSha)) throw Error("Invalid commit id");
    this.get(id);
    this.db
      .prepare("UPDATE git_checkpoints SET after_sha=? WHERE id=?")
      .run(afterSha, id);
    return this.get(id);
  }

  get(id: string): GitCheckpoint {
    const row = this.db
      .prepare("SELECT * FROM git_checkpoints WHERE id=?")
      .get(id) as Row | undefined;
    if (!row) throw Error("Unknown checkpoint");
    return toCheckpoint(row);
  }

  /** Checkpoints of a branch, newest first. */
  history(repository: string, branch: string): GitCheckpoint[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM git_checkpoints WHERE repository=? AND branch=? ORDER BY created_at DESC,rowid DESC",
        )
        .all(repository, branch) as Row[]
    ).map(toCheckpoint);
  }

  /**
   * Returns the commit to restore and marks the checkpoint used. Refused if
   * the branch moved since the operation, so newer work is not discarded.
   */
  rollback(id: string, currentSha: string): string {
    const checkpoint = this.get(id);
    if (checkpoint.rolledBackAt)
      throw Error("This checkpoint was already rolled back");
    if (checkpoint.afterSha && checkpoint.afterSha !== currentSha)
      throw Error(
        "The branch changed after this operation; roll back the later change first",
      );
    this.db
      .prepare("UPDATE git_checkpoints SET rolled_back_at=? WHERE id=?")
      .run(new Date().toISOString(), id);
    return checkpoint.beforeSha;
  }
}
