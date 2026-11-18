// Hosts the Notion connection inside Amun's daemon. Sign-in is Notion's own
// hosted MCP server in an external browser (Edge or Dia); the grant is kept in
// the Mac's Keychain and never leaves the daemon. Signing in does not
// authorize publishing: this file only connects, checks a destination,
// disconnects and exchanges linked memory fields.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { promisify } from "node:util";
import { authCommand } from "../../contracts/src/auth.ts";
import {
  syncCommand,
  type SyncCommand,
} from "../../contracts/src/memory-sync.ts";
import { NOTION_MCP } from "./notion-oauth.ts";
import {
  NotionConnection,
  notionBrowserArgs,
  type NotionBrowser,
} from "./notion-connection.ts";
import type { Keyring } from "./refresh-lock.ts";

/** The Mac's credential store, as the daemon reaches it (never blocking). */
export interface AsyncSecretStore {
  get(account: string): Promise<string | undefined>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<void>;
}

/** Small named values Amun keeps about the connection (never the grant). */
export interface NotionSettings {
  get(id: string): string | null;
  set(id: string, value: string): void;
  remove(ids: string[]): void;
}

/** Runs linked-memory commands against Notion and answers with a snapshot. */
export interface MemorySyncRunner {
  run(
    command: SyncCommand,
    provider: Pick<NotionConnection, "memoryField">,
  ): Promise<void>;
  snapshot(): unknown;
}

export interface NotionHostOptions {
  /** A stable name for this Amun workspace in the credential store. */
  workspace: string;
  /** Amun's own folder for the sign-in lock (owner-only). */
  root: string;
  secrets: AsyncSecretStore;
  settings: NotionSettings;
  registerSecret(value: string): void;
  redact(text: string): string;
  memory?: MemorySyncRunner;
  open?: (browser: NotionBrowser, url: string) => Promise<void>;
  /** For tests: stands in for the hosted connection. */
  connection?: Pick<
    NotionConnection,
    | "connect"
    | "disconnect"
    | "cancelLogin"
    | "inspectTarget"
    | "memoryField"
    | "identity"
  >;
}

export const NOTION_STATUS_ID = "notion-mcp";
const NOTION_ACTIONS = new Set([
  "notion-connect",
  "notion-check",
  "notion-cancel",
  "notion-disconnect",
  "notion-target",
  "notion-status",
]);

/** The credential-store account of this workspace's Notion grant. */
export function notionAccount(workspace: string): string {
  return (
    workspace +
    "/notion-" +
    createHash("sha256").update(NOTION_MCP).digest("hex").slice(0, 32)
  );
}

/**
 * The connection reads and writes its grant synchronously; the daemon's
 * Keychain access is asynchronous so a prompt never blocks it. This keeps the
 * one grant in memory: loaded before an operation, saved after it.
 */
export class GrantKeyring implements Keyring {
  private value: string | undefined;
  private loaded = false;
  private dirty = false;

  constructor(
    private readonly account: string,
    private readonly secrets: AsyncSecretStore,
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.value = await this.secrets.get(this.account);
    this.loaded = true;
  }

  /** Writes any change made since the last save. */
  async save(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.value === undefined) await this.secrets.delete(this.account);
    else await this.secrets.set(this.account, this.value);
  }

  get(account: string): string | undefined {
    return account === this.account ? this.value : undefined;
  }

  set(account: string, value: string): void {
    if (account !== this.account) throw Error("Unexpected credential account");
    this.value = value;
    this.dirty = true;
  }

  delete(account: string): void {
    if (account !== this.account) return;
    this.value = undefined;
    this.dirty = true;
  }
}

export type NotionEvent = Record<string, unknown>;

export class NotionHost {
  private readonly keyring: GrantKeyring;
  private readonly connection: NonNullable<NotionHostOptions["connection"]>;
  private syncing = false;

  constructor(private readonly options: NotionHostOptions) {
    mkdirSync(options.root, { recursive: true, mode: 0o700 });
    chmodSync(options.root, 0o700);
    this.keyring = new GrantKeyring(
      notionAccount(options.workspace),
      options.secrets,
    );
    this.connection =
      options.connection ??
      new NotionConnection({
        workspace: options.workspace,
        root: options.root,
        keyring: this.keyring,
        registerSecret: options.registerSecret,
        open:
          options.open ??
          (async (browser, url) => {
            await promisify(execFile)(
              "/usr/bin/open",
              notionBrowserArgs(browser, url),
              { timeout: 10000 },
            );
          }),
      });
  }

  /** True for the renderer messages this host answers. */
  static handles(message: unknown): boolean {
    if (typeof message !== "object" || message === null) return false;
    const { kind, action } = message as { kind?: unknown; action?: unknown };
    if (kind === "auth") return NOTION_ACTIONS.has(String(action));
    return kind === "workspace" && syncCommand.safeParse(message).success;
  }

  /** With the grant loaded before, and any change saved after. */
  private async withGrant<T>(work: () => Promise<T>): Promise<T> {
    await this.keyring.load();
    try {
      return await work();
    } finally {
      await this.keyring.save();
    }
  }

  private status(status: string): NotionEvent {
    return { version: 1, kind: "auth-status", id: NOTION_STATUS_ID, status };
  }

  private notice(message: string): NotionEvent {
    return {
      version: 1,
      kind: "auth-notice",
      message: this.options.redact(message).slice(0, 4096),
    };
  }

  // What is saved is known without any network or Keychain access.
  private saved(): boolean {
    const { settings } = this.options;
    return (
      settings.get("notion.saved") !== null ||
      settings.get("notion.destination") !== null
    );
  }

  /**
   * Answers one renderer message. What is known at once is returned; anything
   * that takes a browser or the network arrives later through `emit`.
   */
  handle(message: unknown, emit: (event: NotionEvent) => void): NotionEvent[] {
    const sync = syncCommand.safeParse(message);
    if (sync.success) return this.sync(sync.data, emit);
    const command = authCommand.parse(message);
    if (command.action === "notion-status")
      return [this.status(this.saved() ? "configured" : "missing")];
    if (command.action === "notion-cancel") {
      this.connection.cancelLogin();
      return [];
    }
    if (command.action === "notion-target") {
      const url = command.url;
      void this.withGrant(() => this.connection.inspectTarget(url)).then(
        (destination) => {
          const { settings } = this.options;
          settings.set("notion.destination", JSON.stringify(url));
          // Shown beside a plan item so its destination can be checked.
          settings.set(
            "notion.destination.title",
            JSON.stringify(destination.title),
          );
          emit(
            this.notice(
              `Notion verified ${destination.title} (${destination.parentType === "data_source_id" ? "database" : "page"}). Publication is still blocked until content and destination are reviewed.`,
            ),
          );
        },
        () =>
          emit(
            this.notice(
              "Amun could not verify this Notion destination. Check its link and workspace access. Nothing was published.",
            ),
          ),
      );
      return [];
    }
    if (command.action === "notion-disconnect") {
      void this.withGrant(() => this.connection.disconnect()).then(
        () => {
          this.options.settings.remove(["notion.destination", "notion.saved"]);
          emit(this.status("missing"));
          emit(
            this.notice(
              "Notion disconnected from this Amun workspace. Saved credentials and destination were removed. Existing Notion pages are unchanged. Manage server-side access in Notion if you also want to revoke the grant.",
            ),
          );
        },
        () =>
          emit(
            this.notice(
              "Notion disconnect could not be completed. Your connection status has not been confirmed.",
            ),
          ),
      );
      return [];
    }
    if (
      command.action === "notion-connect" ||
      command.action === "notion-check"
    ) {
      const interactive = command.action === "notion-connect";
      const browser = interactive ? command.browser : "edge";
      void this.withGrant(() =>
        this.connection.connect(browser, interactive),
      ).then(
        () => {
          this.options.settings.set("notion.saved", "true");
          emit(this.status("ready"));
          emit(
            this.notice(
              `Notion MCP connected to ${this.connection.identity?.workspaceName ?? "your workspace"}. Publishing still requires review.`,
            ),
          );
        },
        () => {
          emit(this.status("error"));
          emit(
            this.notice(
              "Notion sign-in or access check did not complete. Reconnect in your selected browser; no content was published.",
            ),
          );
        },
      );
      return [this.status("checking")];
    }
    return [];
  }

  /** Linked memory fields: one exchange with Notion at a time. */
  private sync(
    command: SyncCommand,
    emit: (event: NotionEvent) => void,
  ): NotionEvent[] {
    const failed = (text: string): NotionEvent => ({
      version: 1,
      kind: "workspace-error",
      message: text,
    });
    const memory = this.options.memory;
    if (!memory) return [failed("Memory sync is not available.")];
    if (this.syncing) return [failed("A memory sync is in progress.")];
    this.syncing = true;
    void this.withGrant(() => memory.run(command, this.connection))
      .then(
        () => emit(memory.snapshot() as NotionEvent),
        () =>
          emit(
            failed(
              "Memory review changed or the mapping is unavailable. Refresh the product.",
            ),
          ),
      )
      .finally(() => {
        this.syncing = false;
      });
    return [];
  }

  /** Stops a sign-in that is waiting on the browser. */
  stop(): void {
    this.connection.cancelLogin();
  }
}
