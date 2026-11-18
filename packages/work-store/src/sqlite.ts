// The slice of better-sqlite3's API that Amun Beta 0.9's work store used,
// implemented on Node's built-in node:sqlite so no native module ships.
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";

type Params = unknown[];

export interface Statement {
  run(...params: Params): { changes: number; lastInsertRowid: number | bigint };
  get(...params: Params): unknown;
  all(...params: Params): unknown[];
  /** Return only the first column, as better-sqlite3's pluck() does. */
  pluck(): Statement;
}

export interface Transaction<A extends unknown[], R> {
  (...args: A): R;
  immediate(...args: A): R;
}

export interface Database {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  pragma(sql: string, options?: { simple?: boolean }): unknown;
  transaction<A extends unknown[], R>(fn: (...args: A) => R): Transaction<A, R>;
  readonly inTransaction: boolean;
  close(): void;
}

/** better-sqlite3 accepts booleans and undefined; node:sqlite does not. */
function bind(params: Params): SQLInputValue[] {
  return params.map((value) => {
    if (value === undefined) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (
      value !== null &&
      typeof value === "object" &&
      !ArrayBuffer.isView(value)
    ) {
      // Named parameters: pass the object through.
      return value as unknown as SQLInputValue;
    }
    return value as SQLInputValue;
  });
}

function firstColumn(row: unknown): unknown {
  return row && typeof row === "object" ? Object.values(row)[0] : row;
}

function wrap(statement: StatementSync, plucked = false): Statement {
  return {
    run: (...params) => {
      const result = statement.run(...bind(params));
      return {
        changes: Number(result.changes),
        lastInsertRowid: result.lastInsertRowid,
      };
    },
    get: (...params) => {
      const row = statement.get(...bind(params));
      return plucked ? firstColumn(row) : row;
    },
    all: (...params) => {
      const rows = statement.all(...bind(params));
      return plucked ? rows.map(firstColumn) : rows;
    },
    pluck: () => wrap(statement, true),
  };
}

export function openDatabase(file: string): Database {
  const db = new DatabaseSync(file);
  let depth = 0;
  const api: Database = {
    prepare: (sql) => wrap(db.prepare(sql)),
    exec: (sql) => db.exec(sql),
    pragma(sql, options) {
      const rows = db.prepare(`PRAGMA ${sql}`).all() as Record<
        string,
        unknown
      >[];
      if (options?.simple) {
        const first = rows[0];
        return first ? Object.values(first)[0] : undefined;
      }
      return rows;
    },
    transaction<A extends unknown[], R>(fn: (...args: A) => R) {
      const runIn = (begin: string, args: A): R => {
        if (depth > 0) {
          const savepoint = `sp${depth}`;
          db.exec(`SAVEPOINT ${savepoint}`);
          depth++;
          try {
            const result = fn(...args);
            db.exec(`RELEASE ${savepoint}`);
            return result;
          } catch (error) {
            db.exec(`ROLLBACK TO ${savepoint}`);
            db.exec(`RELEASE ${savepoint}`);
            throw error;
          } finally {
            depth--;
          }
        }
        db.exec(begin);
        depth++;
        try {
          const result = fn(...args);
          db.exec("COMMIT");
          return result;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        } finally {
          depth--;
        }
      };
      const tx = ((...args: A) => runIn("BEGIN", args)) as Transaction<A, R>;
      tx.immediate = (...args: A) => runIn("BEGIN IMMEDIATE", args);
      return tx;
    },
    get inTransaction() {
      return db.isTransaction;
    },
    close: () => db.close(),
  };
  return api;
}
