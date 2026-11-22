// Amun's local work model (areas, conversations, plans, reminders, …) from
// Amun Beta 0.9, hosted by the daemon on node:sqlite.
import { migrate } from "./database.ts";
import { Redactor } from "./redaction.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { WorkStore } from "./work-store.ts";
import { WorkspaceService } from "./workspace-service.ts";
import { AdoService, type AdoAccess } from "./ado-service.ts";
import { ToolsService } from "./tools-service.ts";
import { CouncilHost } from "../../council/src/host.ts";
import { fileURLToPath } from "node:url";
import { NotionHost, type AsyncSecretStore } from "../../notion/src/host.ts";
import { TrackerService } from "./trackers/tracker-service.ts";

export { Redactor } from "./redaction.ts";
export { extractDocument } from "./document-import.ts";
export { WorkStore, WorkError } from "./work-store.ts";
export { openDatabase, type Database } from "./sqlite.ts";
export { WorkspaceService } from "./workspace-service.ts";
export { ToolsService } from "./tools-service.ts";
export { recordFirstMateReply } from "./first-mate-thread.ts";
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
  /** Agent command-line tools found on this Mac, and the owner's choices. */
  tools: ToolsService;
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
  const tools = new ToolsService(db);
  return { store, workspace, tools, db, redactor, close: () => db.close() };
}

/** Azure DevOps reads and governed writes over the same database. */
export function openAdo(
  opened: OpenedWorkStore,
  access: AdoAccess,
): AdoService {
  return new AdoService(opened.db, opened.workspace, access, opened.redactor);
}

export { CouncilHost } from "../../council/src/host.ts";

/**
 * The Council (Roast Room) over the same work store. `root` is Amun's own
 * folder for it; `vendor` is the version staged with this build, if any.
 */
export function openCouncil(
  opened: OpenedWorkStore,
  options: { root: string; vendor?: string | null; path?: () => string },
): CouncilHost {
  return new CouncilHost({
    ...options,
    records: opened.store,
    // Built beside this bundle (see the package's build script).
    askServerSource: fileURLToPath(
      new URL("./council-ask-server.js", import.meta.url),
    ),
  });
}

export { NotionHost } from "../../notion/src/host.ts";

/**
 * The Notion connection over the same work store: sign-in through Notion's
 * hosted MCP server, the saved destination, and linked memory fields. The
 * grant goes to `secrets` (the Keychain); only small markers stay in the
 * database.
 */
export function openNotion(
  opened: OpenedWorkStore,
  options: { root: string; workspace: string; secrets: AsyncSecretStore },
): NotionHost {
  const { db, workspace, redactor } = opened;
  return new NotionHost({
    ...options,
    settings: {
      get(id) {
        const row = db
          .prepare("SELECT value_json FROM workspace_settings WHERE id=?")
          .get(id) as { value_json: string } | undefined;
        return row ? row.value_json : null;
      },
      set(id, value) {
        db.prepare(
          "INSERT INTO workspace_settings(id,value_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json",
        ).run(id, value);
      },
      remove(ids) {
        for (const id of ids)
          db.prepare("DELETE FROM workspace_settings WHERE id=?").run(id);
      },
    },
    registerSecret: (value) => redactor.register(value),
    redact: (text) => redactor.text(text),
    memory: {
      run: (command, provider) => workspace.memorySync.run(command, provider),
      snapshot: () => workspace.snapshot(),
    },
  });
}

export { TrackerService } from "./trackers/tracker-service.ts";

/**
 * Linear and Jira over the same work store: browser sign-in through each
 * provider's hosted MCP server (grant in `secrets`, the Keychain), and
 * publishing of plans the captain approved for either, with read-back.
 */
export function openTrackers(
  opened: OpenedWorkStore,
  options: { root: string; workspace: string; secrets: AsyncSecretStore },
): TrackerService {
  const { db, store, redactor } = opened;
  return new TrackerService(db, store, {
    ...options,
    registerSecret: (value) => redactor.register(value),
  });
}
