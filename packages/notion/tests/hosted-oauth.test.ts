import { describe, expect, it } from "vitest";
import {
  ATLASSIAN_ISSUER,
  LINEAR_ISSUER,
  HostedOAuthProvider,
  hostedAuthFetch,
  readHostedOAuthRecord,
} from "../src/notion-oauth.ts";
import { HOSTED_PROVIDERS } from "../src/hosted-providers.ts";
import { hostedAccount, hostedBrowserArgs } from "../src/hosted-connection.ts";
import { createOAuthLoopback } from "../src/oauth-loopback.ts";

function provider(issuer: typeof LINEAR_ISSUER | typeof ATLASSIAN_ISSUER) {
  let value: string | undefined;
  const opened: string[] = [];
  const secrets: string[] = [];
  const oauth = new HostedOAuthProvider({
    issuer,
    read: () => value,
    write: (next) => {
      value = next;
    },
    redirectUrl: "http://127.0.0.1:12345/callback",
    state: "state-1",
    open: async (url) => {
      opened.push(url);
    },
    registerSecret: (secret) => secrets.push(secret),
    stampIssuer: true,
  });
  return { oauth, opened, secrets, value: () => value };
}

const authorize = (base: string) => {
  const url = new URL(base);
  url.searchParams.set("state", "state-1");
  url.searchParams.set("redirect_uri", "http://127.0.0.1:12345/callback");
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", "challenge");
  return url;
};

describe("hosted MCP OAuth records for Linear and Jira", () => {
  it("stamps the checked issuer on answers that omit it and keeps one record", () => {
    const { oauth, secrets, value } = provider(ATLASSIAN_ISSUER);
    oauth.saveClientInformation({ client_id: "client" });
    oauth.saveTokens({
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      token_type: "Bearer",
      expires_in: 28800,
    });
    const record = readHostedOAuthRecord(value(), ATLASSIAN_ISSUER)!;
    expect(record.client?.issuer).toBe(ATLASSIAN_ISSUER);
    expect(record.tokens?.issuer).toBe(ATLASSIAN_ISSUER);
    expect(record.expiresAt).toBeGreaterThan(Date.now());
    expect(secrets).toEqual(
      expect.arrayContaining(["access-secret", "refresh-secret"]),
    );
    // A refresh replaces the tokens in the same record.
    oauth.saveTokens({
      access_token: "rotated",
      token_type: "bearer",
      expires_in: 60,
    });
    const rotated = readHostedOAuthRecord(value(), ATLASSIAN_ISSUER)!;
    expect(rotated.client?.client_id).toBe("client");
    expect(rotated.tokens?.access_token).toBe("rotated");
  });

  it("refuses an answer naming another issuer, and a record of another provider", () => {
    const { oauth, value } = provider(LINEAR_ISSUER);
    expect(() =>
      oauth.saveClientInformation({ client_id: "c", issuer: ATLASSIAN_ISSUER }),
    ).toThrow();
    expect(() =>
      oauth.saveTokens({
        access_token: "a",
        token_type: "Bearer",
        issuer: "https://evil.test",
      }),
    ).toThrow();
    oauth.saveClientInformation({ client_id: "c" });
    expect(() => readHostedOAuthRecord(value(), ATLASSIAN_ISSUER)).toThrow();
  });

  it("opens only the provider's own authorization page", async () => {
    const jira = provider(ATLASSIAN_ISSUER);
    await jira.oauth.redirectToAuthorization(
      authorize("https://auth.atlassian.com/authorize"),
    );
    expect(jira.opened).toHaveLength(1);
    for (const bad of [
      "https://mcp.atlassian.com/v1/authorize",
      "https://auth.atlassian.com.evil.test/authorize",
      "https://auth.atlassian.com/other",
    ])
      await expect(
        jira.oauth.redirectToAuthorization(authorize(bad)),
      ).rejects.toThrow();
    const linear = provider(LINEAR_ISSUER);
    await linear.oauth.redirectToAuthorization(
      authorize("https://mcp.linear.app/authorize"),
    );
    const wrongState = authorize("https://mcp.linear.app/authorize");
    wrongState.searchParams.set("state", "other");
    await expect(
      linear.oauth.redirectToAuthorization(wrongState),
    ).rejects.toThrow();
    expect(linear.opened).toHaveLength(1);
  });

  it("does not start a new grant when a refresh fails", async () => {
    const { oauth } = provider(LINEAR_ISSUER);
    oauth.saveTokens({
      access_token: "a",
      token_type: "Bearer",
      expires_in: 60,
    });
    await expect(
      oauth.redirectToAuthorization(
        authorize("https://mcp.linear.app/authorize"),
      ),
    ).rejects.toThrow("Reconnect Linear");
  });

  it("accepts Atlassian's metadata and refuses endpoints off its origin", () => {
    const { oauth } = provider(ATLASSIAN_ISSUER);
    const metadata = {
      issuer: ATLASSIAN_ISSUER,
      authorization_endpoint: "https://auth.atlassian.com/authorize",
      token_endpoint: "https://auth.atlassian.com/oauth/token",
      registration_endpoint: `${ATLASSIAN_ISSUER}/dcr/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      response_types_supported: ["code"],
    };
    expect(() =>
      oauth.saveDiscoveryState({
        authorizationServerUrl: ATLASSIAN_ISSUER,
        authorizationServerMetadata: metadata,
      }),
    ).not.toThrow();
    expect(() =>
      oauth.saveDiscoveryState({
        authorizationServerUrl: ATLASSIAN_ISSUER,
        authorizationServerMetadata: {
          ...metadata,
          token_endpoint: "https://evil.test/token",
        },
      }),
    ).toThrow();
    expect(() =>
      oauth.saveDiscoveryState({
        authorizationServerUrl: "https://auth.atlassian.com/other",
        authorizationServerMetadata: metadata,
      }),
    ).toThrow();
  });

  it("lets the OAuth exchange reach only the issuer and MCP origins", async () => {
    const seen: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const guarded = hostedAuthFetch(fetcher, ATLASSIAN_ISSUER);
    await guarded("https://auth.atlassian.com/oauth/token");
    await guarded(
      "https://mcp.atlassian.com/.well-known/oauth-protected-resource/v2/mcp",
    );
    await expect(guarded("https://evil.test/token")).rejects.toThrow();
    expect(seen).toHaveLength(2);
  });
});

describe("Keychain account and browser", () => {
  it("is stable per workspace and provider", () => {
    const linear = hostedAccount("amun", HOSTED_PROVIDERS.linear);
    expect(linear).toBe(hostedAccount("amun", HOSTED_PROVIDERS.linear));
    expect(linear).toMatch(/^amun\/linear-[a-f0-9]{32}$/);
    expect(hostedAccount("amun", HOSTED_PROVIDERS.jira)).not.toBe(linear);
    expect(hostedAccount("other", HOSTED_PROVIDERS.linear)).not.toBe(linear);
    expect(() => hostedAccount("../x", HOSTED_PROVIDERS.linear)).toThrow();
  });

  it("opens Edge or Dia only at the provider's authorization page", () => {
    expect(
      hostedBrowserArgs(
        HOSTED_PROVIDERS.jira,
        "edge",
        "https://auth.atlassian.com/authorize?x=1",
      ),
    ).toEqual([
      "-a",
      "Microsoft Edge",
      "https://auth.atlassian.com/authorize?x=1",
    ]);
    expect(() =>
      hostedBrowserArgs(
        HOSTED_PROVIDERS.linear,
        "dia",
        "https://evil.test/authorize",
      ),
    ).toThrow();
  });
});

describe("loopback callback without iss", () => {
  it("accepts an absent iss but never a different one", async () => {
    const callback = await createOAuthLoopback({
      issuer: ATLASSIAN_ISSUER,
      requireIss: false,
      timeoutMs: 1000,
    });
    try {
      expect(
        (
          await fetch(
            `${callback.url}?state=${callback.state}&code=x&iss=https://evil.test`,
          )
        ).status,
      ).toBe(400);
      expect(
        (await fetch(`${callback.url}?state=${callback.state}&code=jira-code`))
          .status,
      ).toBe(200);
      expect(await callback.code).toBe("jira-code");
    } finally {
      callback.close();
    }
  });

  it("still requires iss for Linear", async () => {
    const callback = await createOAuthLoopback({
      issuer: LINEAR_ISSUER,
      timeoutMs: 1000,
    });
    const ended = callback.code.catch(() => "cancelled");
    try {
      expect(
        (await fetch(`${callback.url}?state=${callback.state}&code=x`)).status,
      ).toBe(400);
    } finally {
      callback.close();
    }
    expect(await ended).toBe("cancelled");
  });
});
