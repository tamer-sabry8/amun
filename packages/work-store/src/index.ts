// Amun's local work model (areas, conversations, plans, reminders, …) from
// Amun Beta 0.9, hosted by the daemon on node:sqlite.
import { migrate } from "./database.ts";
import { Redactor } from "./redaction.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { WorkStore } from "./work-store.ts";

export { Redactor } from "./redaction.ts";
export { WorkStore, WorkError } from "./work-store.ts";
export { openDatabase, type Database } from "./sqlite.ts";

export interface OpenedWorkStore {
  store: WorkStore;
  db: Database;
  redactor: Redactor;
  close(): void;
}

export function openWorkStore(
  file: string,
  redactor = new Redactor(),
): OpenedWorkStore {
  const db = openDatabase(file);
  db.pragma("journal_mode = WAL");
  migrate(db);
  const store = new WorkStore(db, redactor);
  return { store, db, redactor, close: () => db.close() };
}
