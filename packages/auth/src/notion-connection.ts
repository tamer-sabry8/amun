import { createHash } from "node:crypto";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { withRefreshLock, type Keyring } from "./broker.ts";
import { createOAuthLoopback } from "./oauth-loopback.ts";
import {
  NOTION_ISSUER,
  NOTION_MCP,
  NotionOAuthProvider,
  notionAuthFetch,
  readNotionOAuthRecord,
} from "./notion-oauth.ts";

export type NotionBrowser = "edge" | "dia";
export function notionBrowserArgs(
  browser: NotionBrowser,
  input: string,
): string[] {
  const url = new URL(input);
  if (
    !["edge", "dia"].includes(browser) ||
    url.origin !== NOTION_ISSUER ||
    url.pathname !== "/authorize" ||
    url.username ||
    url.password ||
    url.hash
  )
    throw Error("Unsafe Notion authorization destination");
  return ["-a", browser === "edge" ? "Microsoft Edge" : "Dia", url.href];
}
/** No authProvider on transport: a rejected write can never cause an auth replay. */
async function verifyMcp(token: string): Promise<void> {
  const client = new Client({ name: "amun", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(NOTION_MCP), {
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
      if (url.href !== NOTION_MCP) throw Error("Unsafe Notion MCP endpoint");
      return fetch(input, {
        ...init,
        redirect: "error",
        signal: AbortSignal.any([
          AbortSignal.timeout(30_000),
          ...(init?.signal ? [init.signal] : []),
        ]),
      });
    },
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    if (!tools.tools.some((tool) => tool.name === "notion-get-self"))
      throw Error("Notion identity tool unavailable");
    const result = await client.callTool({
      name: "notion-get-self",
      arguments: {},
    });
    if (result.isError) throw Error("Notion identity check failed");
  } finally {
    await client.close();
  }
}

export class NotionConnection {
  private busy = false;
  private cancel: (() => void) | undefined;
  private readonly account: string;
  constructor(
    private readonly options: {
      workspace: string;
      root: string;
      keyring: Keyring;
      registerSecret(value: string): void;
      open(browser: NotionBrowser, url: string): Promise<void>;
      fetcher?: typeof fetch;
      verify?: (token: string) => Promise<void>;
    },
  ) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(options.workspace))
      throw Error("Invalid workspace identity");
    this.account =
      options.workspace +
      "/notion-" +
      createHash("sha256").update(NOTION_MCP).digest("hex").slice(0, 32);
  }
  configured() {
    return Boolean(
      readNotionOAuthRecord(this.options.keyring.get(this.account))?.tokens,
    );
  }
  async connect(browser: NotionBrowser, interactive = true): Promise<void> {
    if (this.busy) throw Error("Notion sign-in already active");
    this.busy = true;
    try {
      await withRefreshLock(this.options.root, async () => {
        const stored = readNotionOAuthRecord(
          this.options.keyring.get(this.account),
        );
        if (
          stored?.tokens &&
          stored.expiresAt &&
          stored.expiresAt > Date.now() + 600_000
        ) {
          this.options.registerSecret(stored.tokens.access_token);
          await (this.options.verify ?? verifyMcp)(stored.tokens.access_token);
          return;
        }
        if (!interactive && !stored?.tokens)
          throw Error("Connect Notion first");
        const callback = await createOAuthLoopback({
          issuer: NOTION_ISSUER,
          ...(stored ? { port: Number(new URL(stored.redirectUrl).port) } : {}),
        });
        const provider = new NotionOAuthProvider({
          read: () => this.options.keyring.get(this.account),
          write: (value) => this.options.keyring.set(this.account, value),
          redirectUrl: callback.url,
          state: callback.state,
          open: async (url) => {
            if (!interactive) throw Error("Reconnect Notion");
            await this.options.open(browser, url);
          },
          registerSecret: this.options.registerSecret,
        });
        this.cancel = () => {
          provider.dispose();
          callback.close();
        };
        try {
          const oauthOptions = {
            serverUrl: NOTION_MCP,
            fetchFn: notionAuthFetch(this.options.fetcher),
          };
          const result = await auth(provider, oauthOptions);
          if (result === "REDIRECT")
            await auth(provider, {
              ...oauthOptions,
              authorizationCode: await callback.code,
            });
          const token = provider.tokens()?.access_token;
          if (!token) throw Error("Notion sign-in incomplete");
          await (this.options.verify ?? verifyMcp)(token);
        } finally {
          this.cancel = undefined;
          provider.dispose();
          callback.close();
        }
      });
    } finally {
      this.busy = false;
    }
  }
  cancelLogin() {
    this.cancel?.();
  }
}
