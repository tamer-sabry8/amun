// The official hosted MCP servers Amun signs in to with OAuth in an external
// browser. Every value here was checked against the provider's own published
// metadata on 22 November 2026:
//   Linear:    https://linear.app/docs/mcp and
//              https://mcp.linear.app/.well-known/oauth-authorization-server
//   Atlassian: https://support.atlassian.com/atlassian-rovo-mcp-server/,
//              https://mcp.atlassian.com/.well-known/oauth-protected-resource/v2/mcp
//              (authorization server https://auth.atlassian.com/VCeDsk8Z…) and
//              that server's /.well-known/oauth-authorization-server
// Anything not listed is refused: the authorization page and the token and
// registration endpoints must sit on `authOrigin`, and the MCP endpoint is
// exactly `mcp`.

export const NOTION_ISSUER = "https://mcp.notion.com";
export const CF_ISSUER = "https://mcp.cloudflare.com";
export const LINEAR_ISSUER = "https://mcp.linear.app";
/** Rovo MCP v2 names this authorization server; v1 used mcp.atlassian.com. */
export const ATLASSIAN_ISSUER =
  "https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3";

export type HostedIssuer =
  | typeof NOTION_ISSUER
  | typeof CF_ISSUER
  | typeof LINEAR_ISSUER
  | typeof ATLASSIAN_ISSUER;

export interface HostedProvider {
  /** Amun's name for the connection. */
  id: "notion" | "cloudflare" | "linear" | "jira";
  /** Shown to the captain. */
  label: string;
  /** The authorization server's `issuer`, exactly as it publishes it. */
  issuer: HostedIssuer;
  /** The one origin of the authorization page and token endpoints. */
  authOrigin: string;
  /** Scopes asked for; none beyond what Amun uses. */
  scope?: string;
  /** The streamable HTTP MCP endpoint. */
  mcp: string;
  /** Path of the authorization page on the issuer's origin. */
  authorizePath: string;
  /**
   * The provider sends `iss` back with the code (RFC 9207). When it does not
   * advertise this, an absent `iss` is accepted, but a different one never.
   */
  callbackIss: boolean;
}

export const HOSTED_PROVIDERS = {
  notion: {
    id: "notion",
    label: "Notion",
    issuer: NOTION_ISSUER,
    authOrigin: NOTION_ISSUER,
    mcp: `${NOTION_ISSUER}/mcp`,
    authorizePath: "/authorize",
    callbackIss: true,
  },
  cloudflare: {
    id: "cloudflare",
    label: "Cloudflare",
    issuer: CF_ISSUER,
    authOrigin: CF_ISSUER,
    mcp: `${CF_ISSUER}/mcp`,
    authorizePath: "/authorize",
    callbackIss: true,
  },
  // `authorization_response_iss_parameter_supported: true`.
  linear: {
    id: "linear",
    label: "Linear",
    issuer: LINEAR_ISSUER,
    authOrigin: LINEAR_ISSUER,
    scope: "read write",
    mcp: `${LINEAR_ISSUER}/mcp`,
    authorizePath: "/authorize",
    callbackIss: true,
  },
  // Rovo MCP v2 (v1 moves to v2 on 1 March 2027). Its authorization server
  // is Atlassian's own (auth.atlassian.com) and does not advertise `iss`.
  // Left alone, the SDK would ask for every scope the server lists
  // (Confluence, Bitbucket, Loom, …); Amun asks for Jira only.
  jira: {
    id: "jira",
    label: "Jira",
    issuer: ATLASSIAN_ISSUER,
    authOrigin: "https://auth.atlassian.com",
    scope:
      "read:me read:account offline_access read:jira:agent-interface write:jira:agent-interface search:jira:agent-interface",
    mcp: "https://mcp.atlassian.com/v2/mcp",
    authorizePath: "/authorize",
    callbackIss: false,
  },
} as const satisfies Record<string, HostedProvider>;

export type HostedProviderId = keyof typeof HOSTED_PROVIDERS;

/** Origins the OAuth exchange may reach: the issuer's and the MCP server's. */
export function oauthOrigins(provider: HostedProvider): Set<string> {
  return new Set([provider.authOrigin, new URL(provider.mcp).origin]);
}

export function hostedProviderFor(issuer: HostedIssuer): HostedProvider {
  const found = Object.values(HOSTED_PROVIDERS).find(
    (provider) => provider.issuer === issuer,
  );
  if (!found) throw Error("Unsupported authorization issuer");
  return found;
}
