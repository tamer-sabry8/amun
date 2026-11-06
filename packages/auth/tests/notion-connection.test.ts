import { expect, it } from "vitest";
import { notionBrowserArgs } from "../src/notion-connection.ts";
it("opens Notion consent in the chosen browser only", () => {
  expect(
    notionBrowserArgs("edge", "https://mcp.notion.com/authorize?state=test"),
  ).toEqual([
    "-a",
    "Microsoft Edge",
    "https://mcp.notion.com/authorize?state=test",
  ]);
  expect(notionBrowserArgs("dia", "https://mcp.notion.com/authorize")[1]).toBe(
    "Dia",
  );
  expect(() =>
    notionBrowserArgs("edge", "https://evil.test/authorize"),
  ).toThrow();
  expect(() =>
    notionBrowserArgs("edge", "https://mcp.notion.com/token"),
  ).toThrow();
});

import { mkdtemp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotionConnection } from "../src/notion-connection.ts";
it("completes real SDK discovery/PKCE flow, reuses registration and never retries invalid_grant", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-notion-test-"));
  await chmod(root, 0o700);
  const records = new Map<string, string>();
  let registrations = 0;
  let exchanges = 0;
  let refreshes = 0;
  let opens = 0;
  let checks = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.includes("oauth-protected-resource"))
      return json({
        resource: "https://mcp.notion.com",
        authorization_servers: ["https://mcp.notion.com"],
      });
    if (url.includes("oauth-authorization-server"))
      return json({
        issuer: "https://mcp.notion.com",
        authorization_endpoint: "https://mcp.notion.com/authorize",
        token_endpoint: "https://mcp.notion.com/token",
        registration_endpoint: "https://mcp.notion.com/register",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    if (url.endsWith("/register")) {
      registrations++;
      return json({
        ...JSON.parse(String(init?.body)),
        client_id: "registered-client",
      });
    }
    if (url.endsWith("/token")) {
      const body = new URLSearchParams(String(init?.body));
      if (body.get("grant_type") === "refresh_token") {
        refreshes++;
        return json({ error: "invalid_grant" }, 400);
      }
      exchanges++;
      expect(body.get("code_verifier")).toBeTruthy();
      return json({
        access_token: "test-access",
        refresh_token: "test-refresh",
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    throw Error("Unexpected request");
  };
  const connection = new NotionConnection({
    workspace: "test",
    root,
    keyring: {
      get: (key) => records.get(key),
      set: (key, value) => {
        records.set(key, value);
      },
      delete: (key) => {
        records.delete(key);
      },
    },
    registerSecret: () => {},
    fetcher,
    verify: async (token) => {
      expect(token).toBe("test-access");
      checks++;
    },
    open: async (_browser, href) => {
      opens++;
      const url = new URL(href);
      const target = new URL(url.searchParams.get("redirect_uri")!);
      target.search = new URLSearchParams({
        state: url.searchParams.get("state")!,
        iss: "https://mcp.notion.com",
        code: "test-code",
      }).toString();
      expect((await fetch(target)).status).toBe(200);
    },
  });
  try {
    await connection.connect("edge");
    await connection.connect("edge", false);
    expect({ registrations, exchanges, opens, checks }).toEqual({
      registrations: 1,
      exchanges: 1,
      opens: 1,
      checks: 2,
    });
    for (const [key, value] of records) {
      const parsed = JSON.parse(value);
      parsed.expiresAt = 1;
      records.set(key, JSON.stringify(parsed));
    }
    await expect(connection.connect("edge", false)).rejects.toThrow(
      "Reconnect Notion",
    );
    expect(refreshes).toBe(1);
    expect(opens).toBe(1);
    expect(connection.configured()).toBe(false);
    await connection.connect("dia");
    expect(registrations).toBe(1);
    expect(opens).toBe(2);
  } finally {
    connection.cancelLogin();
    await rm(root, { recursive: true, force: true });
  }
});
