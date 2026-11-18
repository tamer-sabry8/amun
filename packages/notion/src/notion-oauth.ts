import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthClientInformationSchema,
  OAuthTokensSchema,
  type OAuthClientInformationMixed,
  type OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { z } from "zod";
export const NOTION_ISSUER = "https://mcp.notion.com";
export const CF_ISSUER = "https://mcp.cloudflare.com";
type HostedIssuer = typeof NOTION_ISSUER | typeof CF_ISSUER;
export const NOTION_MCP = `${NOTION_ISSUER}/mcp`;
const recordSchema = z.strictObject({
  redirectUrl: z.string().url(),
  client: OAuthClientInformationSchema.optional(),
  tokens: OAuthTokensSchema.optional(),
  expiresAt: z.number().finite().optional(),
});
export type NotionOAuthRecord = z.infer<typeof recordSchema>;
export function readNotionOAuthRecord(
  raw: string | undefined,
  issuer: HostedIssuer = NOTION_ISSUER,
): NotionOAuthRecord | undefined {
  if (!raw) return undefined;
  if (raw.length > 65536) throw Error("Invalid Notion credential record");
  const record = recordSchema.parse(JSON.parse(raw));
  const url = new URL(record.redirectUrl);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.pathname !== "/callback" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (record.client && record.client.issuer !== issuer) ||
    (record.tokens && record.tokens.issuer !== issuer)
  )
    throw Error("Invalid Notion credential record");
  return record;
}

export class NotionOAuthProvider implements OAuthClientProvider {
  private verifier: string | undefined;
  private verifierUntil = 0;
  private disposed = false;
  constructor(
    private readonly options: {
      issuer?: HostedIssuer;
      read(): string | undefined;
      write(value: string): void;
      redirectUrl: string;
      state: string;
      open(url: string): Promise<void>;
      registerSecret(secret: string): void;
    },
  ) {}
  private get issuer() {
    return this.options.issuer ?? NOTION_ISSUER;
  }
  get redirectUrl() {
    return this.options.redirectUrl;
  }
  get clientMetadata() {
    return {
      client_name: "Amun",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  state() {
    return this.options.state;
  }
  private record() {
    return (
      readNotionOAuthRecord(this.options.read(), this.issuer) ?? {
        redirectUrl: this.redirectUrl,
      }
    );
  }
  private save(record: NotionOAuthRecord) {
    if (this.disposed) throw Error("Sign-in cancelled");
    this.options.write(JSON.stringify(record));
  }
  clientInformation() {
    return this.record().client;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    if (info.issuer !== this.issuer)
      throw Error("Unexpected authorization issuer");
    if (info.client_secret) this.options.registerSecret(info.client_secret);
    this.save({
      ...this.record(),
      client: OAuthClientInformationSchema.parse(info),
    });
  }
  tokens() {
    const tokens = this.record().tokens;
    if (tokens) {
      this.options.registerSecret(tokens.access_token);
      if (tokens.refresh_token)
        this.options.registerSecret(tokens.refresh_token);
    }
    return tokens;
  }
  saveTokens(tokens: OAuthTokens) {
    if (
      tokens.issuer !== this.issuer ||
      tokens.token_type.toLowerCase() !== "bearer" ||
      (tokens.expires_in !== undefined &&
        (!Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0))
    )
      throw Error("Invalid Notion tokens");
    this.options.registerSecret(tokens.access_token);
    if (tokens.refresh_token) this.options.registerSecret(tokens.refresh_token);
    const { expiresAt: _old, ...record } = this.record();
    void _old;
    this.save({
      ...record,
      tokens: OAuthTokensSchema.parse(tokens),
      ...(tokens.expires_in === undefined
        ? {}
        : { expiresAt: Date.now() + tokens.expires_in * 1000 }),
    });
  }
  async redirectToAuthorization(url: URL) {
    if (
      this.disposed ||
      url.origin !== this.issuer ||
      url.pathname !== "/authorize" ||
      url.username ||
      url.password ||
      url.hash ||
      url.searchParams.get("state") !== this.state() ||
      url.searchParams.get("redirect_uri") !== this.redirectUrl ||
      url.searchParams.get("code_challenge_method") !== "S256" ||
      !url.searchParams.get("code_challenge")
    )
      throw Error("Invalid Notion authorization destination");
    // A failed refresh must not silently start a new grant.
    if (this.tokens()) throw Error("Reconnect Notion");
    await this.options.open(url.href);
  }
  saveCodeVerifier(value: string) {
    if (this.disposed) throw Error("Sign-in cancelled");
    this.verifier = value;
    this.verifierUntil = Date.now() + 600_000;
    this.options.registerSecret(value);
  }
  codeVerifier() {
    if (!this.verifier || this.disposed || Date.now() >= this.verifierUntil)
      throw Error("Sign-in expired");
    return this.verifier;
  }
  invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): never {
    if (scope === "tokens" || scope === "all") {
      const { tokens: _tokens, expiresAt: _expires, ...record } = this.record();
      void _tokens;
      void _expires;
      this.save(record);
    }
    this.dispose();
    // Throw here to prevent SDK auth() from automatically retrying/re-registering.
    throw Error("Reconnect Notion");
  }
  saveDiscoveryState(state: OAuthDiscoveryState) {
    const metadata = state.authorizationServerMetadata;
    if (
      state.authorizationServerUrl !== this.issuer ||
      metadata?.issuer !== this.issuer ||
      !metadata.code_challenge_methods_supported?.includes("S256") ||
      !metadata.token_endpoint_auth_methods_supported?.includes("none")
    )
      throw Error("Unsupported Notion OAuth metadata");
    for (const endpoint of [
      metadata.authorization_endpoint,
      metadata.token_endpoint,
      metadata.registration_endpoint,
    ]) {
      if (!endpoint || new URL(endpoint).origin !== this.issuer)
        throw Error("Unsafe Notion OAuth endpoint");
    }
  }
  dispose() {
    this.disposed = true;
    this.verifier = undefined;
    this.verifierUntil = 0;
  }
}

/** OAuth JSON only. No redirects, foreign origins, unbounded bodies or raw error logging. */
export function notionAuthFetch(
  fetcher: typeof fetch = fetch,
  issuer: HostedIssuer = NOTION_ISSUER,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== issuer || url.username || url.password || url.hash)
      throw Error("Unsafe Notion OAuth endpoint");
    const response = await fetcher(input, {
      ...init,
      redirect: "error",
      signal: AbortSignal.any([
        AbortSignal.timeout(20_000),
        ...(init?.signal ? [init.signal] : []),
      ]),
    });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader)
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          total += part.value.length;
          if (total > 1_048_576) throw Error("Notion OAuth response too large");
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel();
      }
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(total ? Buffer.concat(chunks) : null, {
      status: response.status,
      headers,
    });
  };
}
