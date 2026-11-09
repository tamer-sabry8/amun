import { readNotionField } from "./notion-memory-field.ts";
import type { RemoteField } from "../../domain/src/memory-sync.ts";
type MemoryExchange = {
  page: string;
  label: string;
  expectedWorkspace: string | null;
  edit?: { before: string; after: string; assertCurrent(): void };
  done: (remote: RemoteField, workspace: string) => void;
};
import {
  findNotionPublication,
  propertyRows,
  type PublicationLookup,
} from "./notion-recovery.ts";
import { randomUUID } from "node:crypto";
import { notionRead } from "./notion-read-backoff.ts";
import { NotionMcpPublisher } from "../../connectors-notion/src/mcp-publication.ts";
import type {
  NotionPublication,
  NotionResult,
} from "../../connectors-notion/src/client.ts";
import { boundedMcpResponse } from "./notion-response.ts";
import {
  notionDestination,
  type NotionDestination,
  notionIdentity,
  notionTargetReference,
  type NotionIdentity,
} from "./notion-result.ts";
import { notionToolPolicy } from "../../domain/src/notion-tools.ts";
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
async function verifyMcp(
  token: string,
  onIdentity?: (identity: NotionIdentity) => void,
  target?: string,
  onTarget?: (target: NotionDestination) => void,
  publication?: {
    input: NotionPublication;
    workspaceId: string;
    beforeSend(): void;
    done(result: NotionResult): void;
  },
  recovery?: {
    intent: PublicationLookup;
    workspaceId: string;
    url?: string;
    done(id: string | undefined): void;
  },
  memory?: MemoryExchange,
): Promise<void> {
  const client = new Client({ name: "amun", version: "0.1.0" });
  let creating = false;
  let committedHint: unknown;
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
      const response = boundedMcpResponse(
        await fetch(input, {
          ...init,
          redirect: "error",
          signal: AbortSignal.any([
            AbortSignal.timeout(30_000),
            ...(init?.signal ? [init.signal] : []),
          ]),
        }),
      );
      if (creating && response.status === 503) {
        try {
          const error = await response.clone().json();
          committedHint = {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: 503,
                  committed_resource_id: error?.committed_resource_id,
                }),
              },
            ],
          };
        } catch {
          /* Reconcile by marker if the response is incomplete. */
        }
      }
      return response;
    },
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    if (!tools.tools.some((tool) => tool.name === "notion-get-self"))
      throw Error("Notion identity tool unavailable");
    const result = await notionRead("notion-get-self", () =>
      client.callTool({
        name: "notion-get-self",
        arguments: {},
      }),
    );
    const identity = notionIdentity(result);
    onIdentity?.(identity);
    const read = async (name: string, args: Record<string, unknown>) => {
      if (
        ![
          "notion-search",
          "notion-fetch",
          "notion-query-data-sources",
        ].includes(name) ||
        !tools.tools.some((t) => t.name === name)
      )
        throw Error("Required Notion read unavailable");
      return client.callTool({ name, arguments: args });
    };
    if (memory) {
      if (
        memory.expectedWorkspace &&
        memory.expectedWorkspace !== identity.workspaceId
      )
        throw Error("Workspace changed");
      const fetchField = async () =>
        readNotionField(
          await notionRead("notion-fetch", () =>
            read("notion-fetch", { id: memory.page }),
          ),
          memory.page,
          memory.label,
        );
      let remote = await fetchField();
      if (
        memory.edit &&
        remote.kind === "value" &&
        remote.value === memory.edit.before
      ) {
        const tool = tools.tools.find((t) => t.name === "notion-update-page");
        if (!tool) throw Error("Notion update unavailable");
        if (!remote.boundary)
          throw Error(
            "The mapped field needs a following line for a conditional update",
          );
        const prefix = memory.label + ": ";
        const patch = {
          page_id: memory.page,
          command: "update_content",
          content_updates: [
            {
              old_str: prefix + remote.value + remote.boundary,
              new_str: prefix + memory.edit.after + remote.boundary,
            },
          ],
          allow_async: false,
        };
        memory.edit.assertCurrent();
        const reply = await client.callTool({
          name: tool.name,
          arguments: tool.inputSchema.properties?.data
            ? { data: patch }
            : patch,
        });
        if (reply.isError) throw Error("Notion update unconfirmed");
        remote = await fetchField();
      }
      memory.done(remote, identity.workspaceId);
    }
    if (recovery) {
      if (identity.workspaceId !== recovery.workspaceId)
        throw Error("Workspace changed");
      recovery.done(
        await findNotionPublication(recovery.intent, read, recovery.url),
      );
    }
    if (publication) {
      if (
        identity.workspaceId.replaceAll("-", "").toLowerCase() !==
        publication.workspaceId.replaceAll("-", "").toLowerCase()
      )
        throw Error("Notion workspace changed; review again");
      if (
        notionToolPolicy("notion-create-pages") !== "approved-publish" ||
        !tools.tools.some((tool) => tool.name === "notion-create-pages")
      )
        throw Error("Notion creation tool unavailable");
      publication.done(
        await new NotionMcpPublisher(
          async (request) => {
            publication.beforeSend();
            creating = true;
            try {
              return await client.callTool(request);
            } catch (error) {
              if (committedHint) return committedHint;
              throw error;
            } finally {
              creating = false;
            }
          },
          async (candidate) => {
            const input = publication.input;
            const marker =
              input.markerPropertyId ??
              /(?:^|\n)Amun publication ID: ([a-f0-9-]{36})$/i.exec(
                input.text,
              )?.[1];
            if (!marker) return;
            return findNotionPublication(
              {
                marker,
                parentId: input.parentId,
                parentType: input.parentType ?? "page_id",
                property: !!input.markerPropertyId,
              },
              read,
              "https://www.notion.so/" + candidate,
            );
          },
        ).create(publication.input),
      );
    }
    if (target) {
      if (
        notionToolPolicy("notion-fetch") !== "read" ||
        !tools.tools.some((tool) => tool.name === "notion-fetch")
      )
        throw Error("Notion destination read unavailable");
      const fetched = await notionRead("notion-fetch", () =>
        client.callTool({
          name: "notion-fetch",
          arguments: { id: notionTargetReference(target) },
        }),
      );
      const destination = notionDestination(
        fetched,
        notionTargetReference(target),
      );
      if (destination.markerPropertyAvailable) {
        try {
          await propertyRows(destination.parentId, randomUUID(), read);
        } catch {
          delete destination.markerPropertyAvailable;
        }
      }
      onTarget?.(destination);
    }
  } finally {
    await client.close();
  }
}

export class NotionConnection {
  identity: NotionIdentity | undefined;
  private busy = false;
  private disconnecting = false;
  private job: Promise<void> | undefined;
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
  private async verify(token: string) {
    if (this.options.verify) return this.options.verify(token);
    await verifyMcp(token, (identity) => {
      this.identity = identity;
    });
  }
  async memoryField(request: Omit<MemoryExchange, "done">) {
    await this.connect("edge", false);
    return withRefreshLock(this.options.root, async () => {
      const record = readNotionOAuthRecord(
        this.options.keyring.get(this.account),
      );
      if (
        !record?.tokens ||
        !record.expiresAt ||
        record.expiresAt <= Date.now()
      )
        throw Error("Reconnect Notion");
      let result: { remote: RemoteField; workspace: string } | undefined;
      await verifyMcp(
        record.tokens.access_token,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          ...request,
          done: (remote, workspace) => {
            result = { remote, workspace };
          },
        },
      );
      if (!result) throw Error("Notion field unavailable");
      return result;
    });
  }
  async inspectTarget(target: string): Promise<NotionDestination> {
    let destination: NotionDestination | undefined;
    notionTargetReference(target);
    await this.connect("edge", false);
    await withRefreshLock(this.options.root, async () => {
      const record = readNotionOAuthRecord(
        this.options.keyring.get(this.account),
      );
      if (
        !record?.tokens ||
        !record.expiresAt ||
        record.expiresAt <= Date.now()
      )
        throw Error("Reconnect Notion");
      this.options.registerSecret(record.tokens.access_token);
      await verifyMcp(
        record.tokens.access_token,
        (identity) => {
          this.identity = identity;
        },
        target,
        (value) => {
          destination = value;
        },
      );
    });
    if (!destination) throw Error("Notion destination unavailable");
    return destination;
  }
  async publish(
    input: NotionPublication,
    workspaceId: string,
    beforeSend: () => void,
  ): Promise<NotionResult> {
    if (!/^[a-f0-9-]{32,36}$/i.test(workspaceId))
      throw Error("Reviewed Notion workspace missing");
    await this.connect("edge", false);
    let outcome: NotionResult = { state: "unknown" };
    await withRefreshLock(this.options.root, async () => {
      const record = readNotionOAuthRecord(
        this.options.keyring.get(this.account),
      );
      if (
        !record?.tokens ||
        !record.expiresAt ||
        record.expiresAt <= Date.now()
      )
        throw Error("Reconnect Notion before publication");
      this.options.registerSecret(record.tokens.access_token);
      await verifyMcp(
        record.tokens.access_token,
        undefined,
        undefined,
        undefined,
        {
          input,
          beforeSend,
          workspaceId,
          done: (result) => {
            outcome = result;
          },
        },
      );
    });
    return outcome;
  }
  async locate(intent: PublicationLookup, workspaceId: string, url?: string) {
    await this.connect("edge", false);
    return withRefreshLock(this.options.root, async () => {
      const record = readNotionOAuthRecord(
        this.options.keyring.get(this.account),
      );
      if (
        !record?.tokens ||
        !record.expiresAt ||
        record.expiresAt <= Date.now()
      )
        throw Error("Reconnect Notion");
      let pageId: string | undefined;
      await verifyMcp(
        record.tokens.access_token,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          intent,
          workspaceId,
          ...(url ? { url } : {}),
          done: (id) => {
            pageId = id;
          },
        },
      );
      return pageId;
    });
  }
  configured() {
    return Boolean(
      readNotionOAuthRecord(this.options.keyring.get(this.account))?.tokens,
    );
  }
  async connect(browser: NotionBrowser, interactive = true): Promise<void> {
    if (this.disconnecting) throw Error("Notion disconnect in progress");
    if (this.busy) {
      if (!interactive && this.job) return this.job;
      throw Error("Notion sign-in already active");
    }
    this.busy = true;
    try {
      this.job = withRefreshLock(this.options.root, async () => {
        const stored = readNotionOAuthRecord(
          this.options.keyring.get(this.account),
        );
        if (
          stored?.tokens &&
          stored.expiresAt &&
          stored.expiresAt > Date.now() + 600_000
        ) {
          this.options.registerSecret(stored.tokens.access_token);
          await this.verify(stored.tokens.access_token);
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
          await this.verify(token);
        } finally {
          this.cancel = undefined;
          provider.dispose();
          callback.close();
        }
      });
      await this.job;
    } finally {
      this.job = undefined;
      this.busy = false;
    }
  }
  async disconnect(): Promise<void> {
    if (this.disconnecting) throw Error("Notion disconnect in progress");
    this.disconnecting = true;
    try {
      this.cancelLogin();
      await this.job?.catch(() => undefined);
      await withRefreshLock(this.options.root, async () => {
        this.options.keyring.delete(this.account);
        this.identity = undefined;
      });
    } finally {
      this.disconnecting = false;
    }
  }
  cancelLogin() {
    this.cancel?.();
  }
}
