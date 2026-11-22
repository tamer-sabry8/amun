// Hand-written surface the daemon uses; the bundle in dist/ is built from src/.
export declare function extractDocument(
  name: string,
  bytes: Buffer,
): Promise<{ kind: string; body: string; image: Buffer | null }>;
export interface WorkStoreLike {
  inspectNavigation?(
    ref: string,
    space: string,
    prompt: string,
    send: (prompt: string) => Promise<void>,
  ): Promise<{ delivered: boolean }>;
  draftNudge?(
    input: unknown,
    send: (prompt: string) => Promise<string>,
    space?: string,
  ): Promise<unknown>;
  snapshot(): unknown;
  handle(input: unknown): unknown[];
  /** Words inside documents, records and conversations, in the current group. */
  search?(query: string): unknown[];
}
/**
 * Saves a First Mate reply Amun did not ask for (a heartbeat, a wake) in the
 * standing "Chat with Firstmate" conversation. Returns the message id, or
 * null when there is no group to put it in.
 */
export declare function recordFirstMateReply(
  store: WorkStoreLike,
  text: string,
  model?: string | null,
  prdRelay?: boolean,
): string | null;
/** Masks registered secrets and common credential shapes in text and objects. */
export declare class Redactor {
  register(secret: string): void;
  text(value: string): string;
  clean(input: unknown): unknown;
}
/** Products, their mapped sources, PRDs and priorities. */
export interface WorkspaceLike {
  bindStoryReview?(
    input: unknown,
    ref: string,
    origin: { areaId: string; chatId: string | null },
    prompt: string,
  ): { parent: string; messageId: string; prompt: string };
  finishStoryReview?(
    ref: string,
    messageId: string,
    text: string,
    ok: boolean,
  ): void;
  author?(
    input: unknown,
    firstmate: (
      model: string,
      instruction: string,
      context: string,
    ) => Promise<string>,
  ): Promise<unknown>;
  snapshot(): unknown;
  handle(input: unknown): unknown;
}
export interface AdoConnectionRef {
  kind: string;
  baseUrl: string;
}
export interface AdoAccess {
  connections(): Promise<AdoConnectionRef[]>;
  secret(connection: AdoConnectionRef): Promise<string | null>;
  fetch?: typeof fetch;
}
/** Azure DevOps backlog reads and governed writes for a product. */
export interface AdoServiceLike {
  handle(
    message: unknown,
    dispatch?: (space: string, prompt: string) => Promise<string>,
  ): Promise<Record<string, unknown> | null>;
}
/** Agent command-line tools found on this Mac, and the owner's choices. */
export interface ToolsServiceLike {
  handle(message: unknown): Promise<Record<string, unknown>>;
}
export interface OpenedWorkStore {
  store: WorkStoreLike;
  workspace: WorkspaceLike;
  tools: ToolsServiceLike;
  redactor: Redactor;
  close(): void;
}
export declare function openWorkStore(
  file: string,
  redactor?: Redactor,
): OpenedWorkStore;
export declare function openAdo(
  opened: OpenedWorkStore,
  access: AdoAccess,
): AdoServiceLike & {
  refreshLinkedBlockers(
    dispatch?: (space: string, prompt: string) => Promise<string>,
  ): Promise<boolean>;
};
/** The Council (Roast Room): status, runs, seats, updates and the room. */
export interface CouncilLike {
  handle(message: unknown): Promise<unknown[]>;
  /** True when something the UI shows changed (a question, or a council ended). */
  poll(): Promise<boolean>;
  checkUpdate(): Promise<void>;
  stop(): void;
}
export declare function openCouncil(
  opened: OpenedWorkStore,
  options: { root: string; vendor?: string | null; path?: () => string },
): CouncilLike;
/** The Mac's credential store, as the daemon reaches it. */
export interface NotionSecretStore {
  get(account: string): Promise<string | undefined>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<void>;
}
/** Notion: browser sign-in, destination check, disconnect, memory sync. */
export interface NotionLike {
  /** What is known at once; the rest arrives later through `emit`. */
  handle(
    message: unknown,
    emit: (event: Record<string, unknown>) => void,
  ): Record<string, unknown>[];
  /** Read only: a search or one page from the connected workspace, as text. */
  lookup(
    request: { kind: "search"; query: string } | { kind: "read"; page: string },
  ): Promise<string>;
  stop(): void;
}
export declare function openNotion(
  opened: OpenedWorkStore,
  options: { root: string; workspace: string; secrets: NotionSecretStore },
): NotionLike;
/** Linear or Jira connection status; never the grant. */
export interface TrackerStatusLike {
  provider: "linear" | "jira";
  status: "missing" | "configured" | "checking" | "ready" | "error";
  identity: {
    user: string | null;
    sites: { id: string; name: string; url: string | null }[];
  } | null;
  message: string | null;
}
/** Linear and Jira: hosted MCP sign-in, and publishing of approved plans. */
export interface TrackersLike {
  /**
   * { action: "list" | "status" | "connect" | "check" | "disconnect" |
   * "cancel" | "targets", provider } or { action: "publish", planId, retry }.
   */
  handle(message: unknown): Promise<Record<string, unknown>>;
  /** True when the plan goes to Linear or Jira. */
  owns(planId: string): boolean;
  /** Publishes an approved Linear or Jira plan; the work store's events. */
  publish(planId: string, retry?: boolean): Promise<unknown[]>;
  /** Looks up writes a crash left uncertain; never sends anything new. */
  recover(): Promise<unknown[]>;
  /** Read only: the sites, projects, boards, sprints, teams and cycles a plan can name. */
  targets(provider: "linear" | "jira"): Promise<string>;
  stop(): void;
}
export declare function openTrackers(
  opened: OpenedWorkStore,
  options: { root: string; workspace: string; secrets: NotionSecretStore },
): TrackersLike;
