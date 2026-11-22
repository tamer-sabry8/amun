// One provider's hosted MCP connection: browser sign-in (OAuth 2.1, dynamic
// client registration, PKCE, a single-use 127.0.0.1 callback), the grant kept
// in Amun's Keychain entry for this workspace and provider, refresh under a
// cross-process lock, and short MCP sessions that never replay a write.
// Notion keeps its own connection (notion-connection.ts); Linear and Jira use
// this one.
import { createHash } from "node:crypto";
import { createOAuthLoopback } from "./oauth-loopback.ts";
import {
  HostedOAuthProvider,
  hostedAuthFetch,
  readHostedOAuthRecord,
} from "./notion-oauth.ts";
import type { HostedProvider } from "./hosted-providers.ts";
import { boundedMcpResponse } from "./notion-response.ts";
import { withRefreshLock, type Keyring } from "./refresh-lock.ts";

export type HostedBrowser = "edge" | "dia" | "default";

/** `open` arguments for an authorization page; only the provider's own. */
export function hostedBrowserArgs(
  provider: HostedProvider,
  browser: HostedBrowser,
  input: string,
): string[] {
  const url = new URL(input);
  if (
    !["edge", "dia", "default"].includes(browser) ||
    url.origin !== provider.authOrigin ||
    url.pathname !== provider.authorizePath ||
    url.username ||
    url.password ||
    url.hash
  )
    throw Error(`Unsafe ${provider.label} authorization destination`);
  if (browser === "default") return [url.href];
  return ["-a", browser === "edge" ? "Microsoft Edge" : "Dia", url.href];
}

export interface McpTool {
  name: string;
  inputSchema?: { properties?: Record<string, unknown> } | undefined;
  annotations?:
    { readOnlyHint?: boolean; destructiveHint?: boolean } | undefined;
}

export interface McpCallResult {
  isError?: boolean | undefined;
  content?: unknown;
  structuredContent?: unknown;
}

/** One short MCP session with the provider. */
export interface McpSession {
  readonly tools: readonly McpTool[];
  call(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
}

export type OpenSession = (
  provider: HostedProvider,
  token: string,
) => Promise<{ session: McpSession; close(): Promise<void> }>;

/**
 * The provider's streamable HTTP endpoint and nothing else. No authProvider
 * on the transport and no reconnection: a write is sent at most once per call.
 */
export const openHostedSession: OpenSession = async (provider, token) => {
  const { Client, StreamableHTTPClientTransport } =
    await import("./mcp-client.ts");
  const client = new Client({ name: "amun", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(provider.mcp), {
    requestInit: {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
    },
    reconnectionOptions: {
      maxRetries: 0,
      initialReconnectionDelay: 1000,
      maxReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 1,
    },
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.href !== provider.mcp)
        throw Error(`Unsafe ${provider.label} MCP endpoint`);
      return boundedMcpResponse(
        await fetch(input, {
          ...init,
          redirect: "error",
          signal: AbortSignal.any([
            AbortSignal.timeout(60_000),
            ...(init?.signal ? [init.signal] : []),
          ]),
        }),
      );
    },
  });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    return {
      session: {
        tools: listed.tools as McpTool[],
        call: async (name, args) =>
          (await client.callTool({ name, arguments: args })) as McpCallResult,
      },
      close: () => client.close(),
    };
  } catch (error) {
    await client.close();
    throw error;
  }
};

/** Stable Keychain account of one workspace's grant for one provider. */
export function hostedAccount(workspace: string, provider: HostedProvider) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(workspace))
    throw Error("Invalid workspace identity");
  return (
    workspace +
    "/" +
    provider.id +
    "-" +
    createHash("sha256").update(provider.mcp).digest("hex").slice(0, 32)
  );
}

export class HostedConnection {
  private busy = false;
  private disconnecting = false;
  private job: Promise<void> | undefined;
  private cancel: (() => void) | undefined;
  readonly account: string;
  constructor(
    private readonly options: {
      provider: HostedProvider;
      workspace: string;
      /** Amun's own owner-only folder for this provider's refresh lock. */
      root: string;
      keyring: Keyring;
      registerSecret(value: string): void;
      open(url: string): Promise<void>;
      fetcher?: typeof fetch;
      openSession?: OpenSession;
      /** Checks a fresh grant works; throws when it does not. */
      verify(session: McpSession): Promise<void>;
    },
  ) {
    this.account = hostedAccount(options.workspace, options.provider);
  }

  private get label() {
    return this.options.provider.label;
  }

  /** True when a grant is saved (it may still need a refresh). */
  configured() {
    return Boolean(
      readHostedOAuthRecord(
        this.options.keyring.get(this.account),
        this.options.provider.issuer,
      )?.tokens,
    );
  }

  private async session<T>(
    token: string,
    work: (session: McpSession) => Promise<T>,
  ): Promise<T> {
    this.options.registerSecret(token);
    const opened = await (this.options.openSession ?? openHostedSession)(
      this.options.provider,
      token,
    );
    try {
      return await work(opened.session);
    } finally {
      await opened.close();
    }
  }

  /**
   * Runs `work` in one MCP session with a current grant, refreshing it first
   * when needed. Never opens a browser: a grant that cannot be refreshed
   * means "Reconnect".
   */
  async use<T>(work: (session: McpSession) => Promise<T>): Promise<T> {
    await this.connect("default", false);
    return withRefreshLock(this.options.root, async () => {
      const record = readHostedOAuthRecord(
        this.options.keyring.get(this.account),
        this.options.provider.issuer,
      );
      if (
        !record?.tokens ||
        !record.expiresAt ||
        record.expiresAt <= Date.now()
      )
        throw Error(`Reconnect ${this.label}`);
      return this.session(record.tokens.access_token, work);
    });
  }

  /**
   * Signs in (interactive) or checks the saved grant, refreshing it when it
   * is close to expiry. A refresh that fails never starts a new grant.
   */
  async connect(browser: HostedBrowser, interactive = true): Promise<void> {
    if (this.disconnecting) throw Error(`${this.label} disconnect in progress`);
    if (this.busy) {
      if (!interactive && this.job) return this.job;
      throw Error(`${this.label} sign-in already active`);
    }
    this.busy = true;
    const { provider } = this.options;
    try {
      this.job = withRefreshLock(this.options.root, async () => {
        const stored = readHostedOAuthRecord(
          this.options.keyring.get(this.account),
          provider.issuer,
        );
        if (
          stored?.tokens &&
          stored.expiresAt &&
          stored.expiresAt > Date.now() + 600_000
        ) {
          if (interactive)
            await this.session(stored.tokens.access_token, this.options.verify);
          else this.options.registerSecret(stored.tokens.access_token);
          return;
        }
        if (!interactive && !stored?.tokens)
          throw Error(`Connect ${this.label} first`);
        const callback = await createOAuthLoopback({
          issuer: provider.issuer,
          requireIss: provider.callbackIss,
          ...(stored ? { port: Number(new URL(stored.redirectUrl).port) } : {}),
        });
        const oauth = new HostedOAuthProvider({
          issuer: provider.issuer,
          read: () => this.options.keyring.get(this.account),
          write: (value) => this.options.keyring.set(this.account, value),
          redirectUrl: callback.url,
          state: callback.state,
          open: async (url) => {
            if (!interactive) throw Error(`Reconnect ${this.label}`);
            await this.options.open(url);
          },
          registerSecret: this.options.registerSecret,
          stampIssuer: true,
        });
        this.cancel = () => {
          oauth.dispose();
          callback.close();
        };
        try {
          const oauthOptions = {
            serverUrl: provider.mcp,
            ...("scope" in provider && provider.scope
              ? { scope: provider.scope }
              : {}),
            fetchFn: hostedAuthFetch(this.options.fetcher, provider.issuer),
          };
          const { auth } = await import("./mcp-client.ts");
          const result = await auth(oauth, oauthOptions);
          if (result === "REDIRECT")
            await auth(oauth, {
              ...oauthOptions,
              authorizationCode: await callback.code,
            });
          const token = oauth.tokens()?.access_token;
          if (!token) throw Error(`${this.label} sign-in incomplete`);
          await this.session(token, this.options.verify);
        } finally {
          this.cancel = undefined;
          oauth.dispose();
          callback.close();
        }
      });
      await this.job;
    } finally {
      this.job = undefined;
      this.busy = false;
    }
  }

  /** Removes this workspace's grant from the Keychain. */
  async disconnect(): Promise<void> {
    if (this.disconnecting) throw Error(`${this.label} disconnect in progress`);
    this.disconnecting = true;
    try {
      this.cancelLogin();
      await this.job?.catch(() => undefined);
      await withRefreshLock(this.options.root, async () => {
        this.options.keyring.delete(this.account);
      });
    } finally {
      this.disconnecting = false;
    }
  }

  cancelLogin() {
    this.cancel?.();
  }
}
