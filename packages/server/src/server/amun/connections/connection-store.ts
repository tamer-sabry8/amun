import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { adoCollectionUrl, patIsWellFormed, probeAdo, type AdoProject, type FetchLike } from "./ado-probe.js";
import type { SecretStore } from "./secret-store.js";

export type ConnectionKind = "ado" | "github" | "notion" | "obsidian";

export interface Connection {
  kind: ConnectionKind;
  baseUrl: string;
}

export type ConnectionStatus = "missing" | "configured" | "checking" | "ready" | "error" | "unknown";

export interface ConnectionView extends Connection {
  id: string;
  status: ConnectionStatus;
  /** Who the token signs in as, and what it could read at the last check. */
  user: string | null;
  projects: AdoProject[];
  message: string | null;
  checkedAt: string | null;
}

export class ConnectionRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionRefusedError";
  }
}

/** Stable id per kind + endpoint. */
export function connectionId(connection: Connection): string {
  const url = new URL(connection.baseUrl);
  return `${connection.kind}-${createHash("sha256").update(url.href.replace(/\/$/, "")).digest("hex").slice(0, 32)}`;
}

interface Saved {
  version: 1;
  connections: Connection[];
}

interface Checked {
  status: ConnectionStatus;
  user: string | null;
  projects: AdoProject[];
  message: string | null;
  checkedAt: string | null;
}

/**
 * Amun's own connections (~/.amun/connections.json, no secrets) with the
 * secrets in the OS Keychain. Azure DevOps is supported; the other kinds come
 * with their own port.
 */
export class ConnectionStore {
  private readonly file: string;
  private readonly checked = new Map<string, Checked>();

  constructor(
    amunHome: string,
    private readonly secrets: SecretStore,
    private readonly options: { fetch?: FetchLike; now?: () => Date } = {},
  ) {
    this.file = path.join(amunHome, "connections.json");
  }

  private now(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }

  private account(connection: Connection): string {
    return `connection/${connectionId(connection)}`;
  }

  private async load(): Promise<Connection[]> {
    if (!existsSync(this.file)) return [];
    const saved = JSON.parse(await readFile(this.file, "utf8")) as Saved;
    return saved.connections;
  }

  private async store(connections: Connection[]): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify({ version: 1, connections } satisfies Saved, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temp, this.file);
  }

  private normalize(connection: Connection): Connection {
    if (connection.kind !== "ado") {
      throw new ConnectionRefusedError("Only Azure DevOps connects in this Amun build so far.");
    }
    return { kind: "ado", baseUrl: adoCollectionUrl(connection.baseUrl) };
  }

  async list(): Promise<ConnectionView[]> {
    const views: ConnectionView[] = [];
    for (const connection of await this.load()) {
      const id = connectionId(connection);
      const known = this.checked.get(id);
      views.push({
        ...connection,
        id,
        ...(known ?? { status: "configured", user: null, projects: [], message: null, checkedAt: null }),
      });
    }
    return views;
  }

  /** Checks the token against the server first; only a working token is kept. */
  async save(input: Connection, secret: string): Promise<ConnectionView> {
    const connection = this.normalize(input);
    const pat = secret.trim();
    if (!patIsWellFormed(pat)) {
      throw new ConnectionRefusedError(
        "That doesn't look like a personal access token. Copy the whole token from Azure DevOps > User settings > Personal access tokens.",
      );
    }
    const result = await probeAdo({
      collectionUrl: connection.baseUrl,
      pat,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    });
    if (!result.ok) throw new ConnectionRefusedError(result.message);
    await this.secrets.set(this.account(connection), pat);
    const connections = (await this.load()).filter((c) => connectionId(c) !== connectionId(connection));
    await this.store([...connections, connection]);
    const id = connectionId(connection);
    this.checked.set(id, {
      status: "ready",
      user: result.user,
      projects: result.projects,
      message: null,
      checkedAt: this.now(),
    });
    return (await this.list()).find((c) => c.id === id)!;
  }

  async check(input: Connection): Promise<ConnectionView> {
    const connection = this.normalize(input);
    const id = connectionId(connection);
    let pat: string | undefined;
    try {
      pat = await this.secrets.get(this.account(connection));
    } catch (error) {
      this.checked.set(id, {
        status: "unknown",
        user: null,
        projects: [],
        message: error instanceof Error ? error.message : "Keychain could not be read",
        checkedAt: this.now(),
      });
      return (await this.list()).find((c) => c.id === id)!;
    }
    if (!pat) {
      this.checked.set(id, {
        status: "missing",
        user: null,
        projects: [],
        message: "No token saved. Connect again.",
        checkedAt: this.now(),
      });
    } else {
      const result = await probeAdo({
        collectionUrl: connection.baseUrl,
        pat,
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      });
      this.checked.set(
        id,
        result.ok
          ? { status: "ready", user: result.user, projects: result.projects, message: null, checkedAt: this.now() }
          : { status: "error", user: null, projects: [], message: result.message, checkedAt: this.now() },
      );
    }
    return (await this.list()).find((c) => c.id === id)!;
  }

  async forget(input: Connection): Promise<void> {
    const connection = this.normalize(input);
    const id = connectionId(connection);
    await this.secrets.delete(this.account(connection)).catch(() => undefined);
    await this.store((await this.load()).filter((c) => connectionId(c) !== id));
    this.checked.delete(id);
  }

  /** The saved token for server-side Azure calls. Never sent to the UI. */
  async token(input: Connection): Promise<string | undefined> {
    return this.secrets.get(this.account(this.normalize(input)));
  }
}
