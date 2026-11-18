// Amun's local work model (areas, conversations, plans, reminders, …) from
// Amun Beta 0.9, hosted by the daemon on node:sqlite.
import { migrate } from "./database.ts";
import { Redactor } from "./redaction.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { WorkStore } from "./work-store.ts";
import { WorkspaceService } from "./workspace-service.ts";
import { AdoService, type AdoAccess } from "./ado-service.ts";

export { Redactor } from "./redaction.ts";
export { WorkStore, WorkError } from "./work-store.ts";
export { openDatabase, type Database } from "./sqlite.ts";
export { WorkspaceService } from "./workspace-service.ts";
export {
  AdoService,
  NO_AZURE_PROJECT,
  type AdoAccess,
  type AdoConnectionRef,
} from "./ado-service.ts";

export interface OpenedWorkStore {
  store: WorkStore;
  /** Products, their mapped sources, PRDs and priorities (same database). */
  workspace: WorkspaceService;
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
  const workspace = new WorkspaceService(db, redactor);
  return { store, workspace, db, redactor, close: () => db.close() };
}

/** Azure DevOps reads and governed writes over the same database. */
export function openAdo(
  opened: OpenedWorkStore,
  access: AdoAccess,
): AdoService {
  return new AdoService(opened.db, opened.workspace, access, opened.redactor);
}
