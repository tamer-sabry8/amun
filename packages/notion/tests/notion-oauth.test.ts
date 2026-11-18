import { expect, it } from "vitest";
import { NotionOAuthProvider, notionAuthFetch } from "../src/notion-oauth.ts";

function fixture() {
  let value: string | undefined;
  const opened: string[] = [];
  const provider = new NotionOAuthProvider({
    read: () => value,
    write: (next) => {
      value = next;
    },
    redirectUrl: "http://127.0.0.1:12345/callback",
    state: "test-state",
    open: async (url) => {
      opened.push(url);
    },
    registerSecret: () => {},
  });
  return { provider, opened, value: () => value };
}
it("persists registration and tokens together, binds issuer, and expires verifier", async () => {
  const { provider, value } = fixture();
  provider.saveClientInformation({
    client_id: "client",
    issuer: "https://mcp.notion.com",
  });
  provider.saveTokens({
    access_token: "secret",
    refresh_token: "refresh",
    token_type: "Bearer",
    expires_in: 3600,
    issuer: "https://mcp.notion.com",
  });
  expect(provider.clientInformation()?.client_id).toBe("client");
  expect(provider.tokens()?.access_token).toBe("secret");
  expect(value()).toContain("12345/callback");
  provider.saveCodeVerifier("verifier");
  expect(provider.codeVerifier()).toBe("verifier");
  provider.dispose();
  expect(() => provider.codeVerifier()).toThrow();
});
it("blocks SDK invalid-grant retries and preserves registration for reconnect", () => {
  const { provider } = fixture();
  provider.saveClientInformation({
    client_id: "client",
    issuer: "https://mcp.notion.com",
  });
  provider.saveTokens({
    access_token: "secret",
    token_type: "Bearer",
    issuer: "https://mcp.notion.com",
  });
  expect(() => provider.invalidateCredentials("tokens")).toThrow(
    "Reconnect Notion",
  );
  expect(provider.tokens()).toBeUndefined();
  expect(provider.clientInformation()?.client_id).toBe("client");
});
it("rejects foreign credentials and unsafe browser destinations", async () => {
  const { provider, opened } = fixture();
  expect(() =>
    provider.saveTokens({
      access_token: "secret",
      token_type: "Bearer",
      issuer: "https://evil.test",
    }),
  ).toThrow();
  await expect(
    provider.redirectToAuthorization(new URL("https://evil.test/authorize")),
  ).rejects.toThrow();
  await expect(
    provider.redirectToAuthorization(
      new URL("https://mcp.notion.com/authorize?state=wrong"),
    ),
  ).rejects.toThrow();
  expect(opened).toEqual([]);
});
it("never follows token redirects or makes requests to other hosts", async () => {
  let calls = 0;
  const fetcher = notionAuthFetch(async (_url, init) => {
    calls++;
    expect(init?.redirect).toBe("error");
    return new Response('{"ok":true}', {
      headers: { "Content-Type": "application/json" },
    });
  });
  await expect(fetcher("https://evil.test/token")).rejects.toThrow();
  await expect(fetcher("https://mcp.notion.com/token")).resolves.toBeInstanceOf(
    Response,
  );
  expect(calls).toBe(1);
});
