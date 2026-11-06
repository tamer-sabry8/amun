import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import lockfile from "proper-lockfile";
import type { Redactor } from "../../security/src/redaction.ts";
export type ConnectionKind = "ado" | "github" | "notion";
export interface Connection {
  kind: ConnectionKind;
  baseUrl: string;
}
export type ConnectionStatus =
  "missing" | "configured" | "checking" | "ready" | "error";
export interface Keyring {
  get(account: string): string | undefined;
  set(account: string, value: string): void;
  delete(account: string): void;
}
export const modelLoginOptions: readonly {
  provider: string;
  type: "oauth" | "api_key";
  label: string;
}[] = [
  { provider: "github-copilot", type: "oauth", label: "GitHub Copilot" },
  { provider: "openrouter", type: "oauth", label: "OpenRouter" },
  { provider: "openai-codex", type: "oauth", label: "OpenAI / Codex" },
  { provider: "openai", type: "api_key", label: "OpenAI API key" },
  { provider: "openrouter", type: "api_key", label: "OpenRouter API key" },
  { provider: "anthropic", type: "api_key", label: "Anthropic API key" },
];
export function connectionId(connection: Connection): string {
  if (!["ado", "github", "notion"].includes(connection.kind))
    throw Error("Unsupported connection");
  const url = new URL(connection.baseUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("Unsafe connection endpoint");
  if (
    connection.kind === "notion" &&
    (url.origin !== "https://api.notion.com" || url.pathname !== "/")
  )
    throw Error("Unsupported Notion endpoint");
  if (connection.kind === "github" && url.pathname !== "/")
    throw Error("GitHub connection must identify a host");
  return (
    connection.kind +
    "-" +
    createHash("sha256")
      .update(url.href.replace(/\/$/, ""))
      .digest("hex")
      .slice(0, 32)
  );
}
export class AuthBroker {
  private readonly workspace: string;
  private readonly keyring: Keyring;
  private readonly redactor: Redactor;
  private readonly probe: (
    connection: Connection,
    secret: string,
  ) => Promise<boolean>;
  private readonly states = new Map<string, ConnectionStatus>();
  private readonly generations = new Map<string, number>();
  private next(connection: Connection): number {
    const id = connectionId(connection);
    const generation = (this.generations.get(id) ?? 0) + 1;
    this.generations.set(id, generation);
    return generation;
  }
  constructor(
    workspace: string,
    keyring: Keyring,
    redactor: Redactor,
    probe: (connection: Connection, secret: string) => Promise<boolean>,
  ) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(workspace))
      throw Error("Invalid workspace identity");
    this.workspace = workspace;
    this.keyring = keyring;
    this.redactor = redactor;
    this.probe = probe;
  }
  private account(connection: Connection): string {
    return this.workspace + "/" + connectionId(connection);
  }
  save(connection: Connection, secret: string): void {
    const account = this.account(connection);
    if (!secret || secret.length > 65536 || /[\r\n\0]/.test(secret))
      throw Error("Invalid credential");
    this.redactor.register(secret);
    this.keyring.set(account, secret);
    this.next(connection);
    this.states.set(connectionId(connection), "configured");
  }
  status(connection: Connection): ConnectionStatus {
    const id = connectionId(connection);
    const current = this.states.get(id);
    if (current) return current;
    try {
      const secret = this.keyring.get(this.account(connection));
      if (secret) this.redactor.register(secret);
      return secret ? "configured" : "missing";
    } catch {
      return "error";
    }
  }
  async check(connection: Connection): Promise<ConnectionStatus> {
    const id = connectionId(connection);
    const generation = this.next(connection);
    this.states.set(id, "checking");
    let state: ConnectionStatus;
    try {
      const secret = this.keyring.get(this.account(connection));
      if (!secret) state = "missing";
      else {
        this.redactor.register(secret);
        state = (await this.probe(connection, secret)) ? "ready" : "error";
      }
    } catch {
      state = "error";
    }
    if (this.generations.get(id) !== generation) return this.status(connection);
    this.states.set(id, state);
    return state;
  }
  forget(connection: Connection): void {
    this.keyring.delete(this.account(connection));
    this.next(connection);
    this.states.set(connectionId(connection), "missing");
  }
  describe(connections: readonly Connection[]) {
    return connections.map((connection) => ({
      id: connectionId(connection),
      kind: connection.kind,
      baseUrl: new URL(connection.baseUrl).href,
      status: this.status(connection),
    }));
  }
}
export async function withRefreshLock<T>(
  root: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!isAbsolute(root)) throw Error("Auth root must be absolute");
  const stat = await lstat(root);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw Error("Unsafe auth root");
  const release = await lockfile.lock(root, {
    lockfilePath: join(root, ".amun-refresh.lock"),
    stale: 30000,
    update: 5000,
    retries: { retries: 30, minTimeout: 25, maxTimeout: 100, factor: 1.1 },
  });
  try {
    return await operation();
  } finally {
    await release();
  }
}
