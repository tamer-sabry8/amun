// Linear and Jira connections inside Amun's daemon. Sign-in is each
// provider's own hosted MCP server in an external browser; the grant is kept
// in the Mac's Keychain (one stable entry per Amun workspace and provider,
// updated in place on refresh, deleted on disconnect) and never leaves the
// daemon. Writes go through the governed plan publisher, never from here.
import { execFile } from "node:child_process";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { GrantKeyring, type AsyncSecretStore } from "./host.ts";
import {
  HostedConnection,
  hostedAccount,
  hostedBrowserArgs,
  type HostedBrowser,
  type McpCallResult,
  type McpSession,
  type OpenSession,
} from "./hosted-connection.ts";
import { HOSTED_PROVIDERS, type HostedProvider } from "./hosted-providers.ts";

export type TrackerId = "linear" | "jira";
export const TRACKERS: readonly TrackerId[] = ["linear", "jira"];

/** Who the grant signs in as and which workspaces or sites it reaches. */
export interface TrackerIdentity {
  user: string | null;
  /** Linear: the workspace. Jira: each Jira site (cloudId, url). */
  sites: { id: string; name: string; url: string | null }[];
}

export interface TrackerStatus {
  provider: TrackerId;
  status: "missing" | "configured" | "checking" | "ready" | "error";
  identity: TrackerIdentity | null;
  message: string | null;
}

/** The JSON text an MCP tool answered with. */
export function toolJson(result: McpCallResult): unknown {
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text: unknown }).text)
        : "",
    )
    .join("");
  if (result.structuredContent && typeof result.structuredContent === "object")
    return result.structuredContent;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const str = (value: unknown) => (typeof value === "string" ? value : null);

async function readTool(session: McpSession, name: string, args = {}) {
  if (!session.tools.some((tool) => tool.name === name))
    throw Error(`Required tool ${name} unavailable`);
  const result = await session.call(name, args);
  if (result.isError) throw Error(`${name} refused`);
  return toolJson(result);
}

/** Reads who the grant is and what it reaches; nothing is written. */
export async function identify(
  provider: TrackerId,
  session: McpSession,
): Promise<TrackerIdentity> {
  if (provider === "linear") {
    const user = record(await readTool(session, "get_user", { query: "me" }));
    const sites: TrackerIdentity["sites"] = [];
    if (session.tools.some((tool) => tool.name === "get_workspace")) {
      const workspace = record(await readTool(session, "get_workspace"));
      const id = str(workspace.id);
      if (id)
        sites.push({
          id,
          name: str(workspace.name) ?? id,
          url: str(workspace.url) ?? str(workspace.urlKey),
        });
    }
    if (!str(user.id)) throw Error("Linear identity unavailable");
    return { user: str(user.displayName) ?? str(user.name), sites };
  }
  const resources = record(
    record(await readTool(session, "getAccessibleAtlassianResources")).data,
  ).resources;
  const sites = (Array.isArray(resources) ? resources : [])
    .map(record)
    .filter((site) =>
      (Array.isArray(site.products) ? site.products : []).some(
        (product) =>
          record(product).id === "jira" &&
          String(record(product).access).includes("write"),
      ),
    )
    .map((site) => ({
      id: String(site.cloudId ?? site.id ?? ""),
      name: String(site.name ?? site.url ?? site.cloudId ?? ""),
      url: str(site.url),
    }))
    .filter((site) => /^[a-f0-9-]{36}$/i.test(site.id));
  if (!sites.length) throw Error("No Jira site this account can write to");
  return { user: null, sites };
}

export interface TrackerHostOptions {
  /** A stable name for this Amun workspace in the credential store. */
  workspace: string;
  /** Amun's own folder; each provider gets an owner-only lock folder in it. */
  root: string;
  secrets: AsyncSecretStore;
  registerSecret(value: string): void;
  browser?: () => HostedBrowser;
  open?: (provider: HostedProvider, url: string) => Promise<void>;
  /** For tests: stands in for the MCP server. */
  openSession?: OpenSession;
  fetcher?: typeof fetch;
}

/** One Linear and one Jira connection for this Amun workspace. */
export class TrackerHost {
  /** The browser the captain chose for each provider's sign-in. */
  private readonly browsers = new Map<TrackerId, "edge" | "dia">();
  private readonly entries = new Map<
    TrackerId,
    {
      keyring: GrantKeyring;
      connection: HostedConnection;
      identity: TrackerIdentity | null;
      status: TrackerStatus["status"] | null;
      message: string | null;
    }
  >();

  constructor(private readonly options: TrackerHostOptions) {
    for (const id of TRACKERS) {
      const provider = HOSTED_PROVIDERS[id];
      const root = path.join(options.root, id);
      mkdirSync(root, { recursive: true, mode: 0o700 });
      chmodSync(root, 0o700);
      const keyring = new GrantKeyring(
        hostedAccount(options.workspace, provider),
        options.secrets,
      );
      const entry = {
        keyring,
        identity: null as TrackerIdentity | null,
        status: null as TrackerStatus["status"] | null,
        message: null as string | null,
        connection: new HostedConnection({
          provider,
          workspace: options.workspace,
          root,
          keyring,
          registerSecret: options.registerSecret,
          ...(options.openSession ? { openSession: options.openSession } : {}),
          ...(options.fetcher ? { fetcher: options.fetcher } : {}),
          open: (url) =>
            (
              options.open ??
              (async (p: HostedProvider, u: string) => {
                await promisify(execFile)(
                  "/usr/bin/open",
                  hostedBrowserArgs(
                    p,
                    this.browsers.get(id) ?? options.browser?.() ?? "edge",
                    u,
                  ),
                  { timeout: 10_000 },
                );
              })
            )(provider, url),
          verify: async (session) => {
            entry.identity = await identify(id, session);
          },
        }),
      };
      this.entries.set(id, entry);
    }
  }

  private entry(provider: TrackerId) {
    const found = this.entries.get(provider);
    if (!found) throw Error("Unsupported tracker");
    return found;
  }

  /** The grant loaded before, and any change (a refresh) saved after. */
  private async withGrant<T>(provider: TrackerId, work: () => Promise<T>) {
    const { keyring } = this.entry(provider);
    await keyring.load();
    try {
      return await work();
    } finally {
      await keyring.save();
    }
  }

  private view(provider: TrackerId): TrackerStatus {
    const entry = this.entry(provider);
    return {
      provider,
      status:
        entry.status ??
        (entry.connection.configured() ? "configured" : "missing"),
      identity: entry.identity,
      message: entry.message,
    };
  }

  /** What is known now, after reading the Keychain entry. */
  async status(provider: TrackerId): Promise<TrackerStatus> {
    await this.entry(provider).keyring.load();
    return this.view(provider);
  }

  /**
   * Signs in through the browser (`connect`) or checks the saved grant
   * (`check`), and reads who it is. Nothing is written to the tracker.
   */
  async connect(
    provider: TrackerId,
    interactive: boolean,
    browser: "edge" | "dia" = "edge",
  ) {
    const entry = this.entry(provider);
    this.browsers.set(provider, browser);
    try {
      await this.withGrant(provider, async () => {
        if (interactive) await entry.connection.connect(browser, true);
        else
          await entry.connection.use(async (session) => {
            entry.identity = await identify(provider, session);
          });
      });
      entry.status = "ready";
      entry.message = null;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      entry.status = /connect .* first/i.test(text) ? "missing" : "error";
      entry.message = /reconnect|connect .* first/i.test(text)
        ? `Connect ${HOSTED_PROVIDERS[provider].label} again in Settings.`
        : `${HOSTED_PROVIDERS[provider].label} did not answer the check.`;
    }
    return this.view(provider);
  }

  cancel(provider: TrackerId) {
    this.entry(provider).connection.cancelLogin();
  }

  /** Deletes this workspace's Keychain entry for the provider. */
  async disconnect(provider: TrackerId) {
    const entry = this.entry(provider);
    await this.withGrant(provider, () => entry.connection.disconnect());
    entry.identity = null;
    entry.status = "missing";
    entry.message = null;
    return this.view(provider);
  }

  /** One MCP session with a current grant, for the governed writers. */
  use<T>(provider: TrackerId, work: (session: McpSession) => Promise<T>) {
    const entry = this.entry(provider);
    return this.withGrant(provider, () => entry.connection.use(work));
  }

  stop() {
    for (const id of TRACKERS) this.cancel(id);
  }
}
