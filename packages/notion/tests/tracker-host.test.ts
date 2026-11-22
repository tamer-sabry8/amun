import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TrackerHost } from "../src/tracker-host.ts";
import { hostedAccount, type OpenSession } from "../src/hosted-connection.ts";
import {
  ATLASSIAN_ISSUER,
  HOSTED_PROVIDERS,
  LINEAR_ISSUER,
} from "../src/hosted-providers.ts";

const reply = (value: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});

function setup() {
  const store = new Map<string, string>();
  const writes: string[] = [];
  const registered: string[] = [];
  const tokens: string[] = [];
  const openSession: OpenSession = async (provider, token) => {
    tokens.push(`${provider.id}:${token}`);
    const tools = [
      "get_user",
      "get_workspace",
      "getAccessibleAtlassianResources",
    ].map((name) => ({ name }));
    return {
      session: {
        tools,
        call: async (name) =>
          name === "get_user"
            ? reply({ id: "u1", displayName: "captain" })
            : name === "get_workspace"
              ? reply({
                  id: "w1",
                  name: "Transfrm",
                  url: "https://linear.app/acme",
                })
              : reply({
                  data: {
                    resources: [
                      {
                        cloudId: "ca5a06a5-930e-490e-8955-453103dc863c",
                        url: "https://acme.atlassian.net",
                        products: [{ id: "jira", access: "read-write" }],
                      },
                    ],
                  },
                }),
      },
      close: async () => {},
    };
  };
  const host = new TrackerHost({
    workspace: "amun",
    root: mkdtempSync(path.join(tmpdir(), "amun-trackers-")),
    secrets: {
      get: async (account) => store.get(account),
      set: async (account, secret) => {
        writes.push(account);
        store.set(account, secret);
      },
      delete: async (account) => {
        store.delete(account);
      },
    },
    registerSecret: (value) => registered.push(value),
    openSession,
    open: async () => {
      throw Error("no browser in tests");
    },
  });
  const grant = (issuer: string, access: string) =>
    JSON.stringify({
      redirectUrl: "http://127.0.0.1:43123/callback",
      client: { client_id: "client", issuer },
      tokens: {
        access_token: access,
        token_type: "Bearer",
        issuer,
        refresh_token: "r-" + access,
      },
      expiresAt: Date.now() + 3_600_000,
    });
  return { host, store, writes, registered, tokens, grant };
}

describe("Linear and Jira connections", () => {
  it("reports missing with no Keychain entry and never asks for a browser on check", async () => {
    const { host } = setup();
    expect((await host.status("linear")).status).toBe("missing");
    const checked = await host.connect("linear", false);
    expect(checked.status).toBe("missing");
    expect(checked.message).toBe("Connect Linear again in Settings.");
  });

  it("checks a saved grant, reads who it is and keeps the token out of the answer", async () => {
    const { host, store, registered, tokens, grant } = setup();
    store.set(
      hostedAccount("amun", HOSTED_PROVIDERS.linear),
      grant(LINEAR_ISSUER, "linear-access"),
    );
    store.set(
      hostedAccount("amun", HOSTED_PROVIDERS.jira),
      grant(ATLASSIAN_ISSUER, "jira-access"),
    );
    const linear = await host.connect("linear", false);
    expect(linear).toMatchObject({
      status: "ready",
      identity: {
        user: "captain",
        sites: [{ id: "w1", url: "https://linear.app/acme" }],
      },
    });
    const jira = await host.connect("jira", false);
    expect(jira.identity?.sites).toEqual([
      {
        id: "ca5a06a5-930e-490e-8955-453103dc863c",
        name: "https://acme.atlassian.net",
        url: "https://acme.atlassian.net",
      },
    ]);
    expect(registered).toEqual(
      expect.arrayContaining(["linear-access", "jira-access"]),
    );
    expect(tokens).toEqual(["linear:linear-access", "jira:jira-access"]);
    expect(JSON.stringify([linear, jira])).not.toMatch(/access|r-linear/);
  });

  it("refuses a grant stored for another issuer", async () => {
    const { host, store, grant } = setup();
    store.set(
      hostedAccount("amun", HOSTED_PROVIDERS.jira),
      grant(LINEAR_ISSUER, "wrong"),
    );
    expect((await host.connect("jira", false)).status).toBe("error");
  });

  it("deletes only its own entry on disconnect", async () => {
    const { host, store, grant } = setup();
    const linear = hostedAccount("amun", HOSTED_PROVIDERS.linear);
    const jira = hostedAccount("amun", HOSTED_PROVIDERS.jira);
    store.set(linear, grant(LINEAR_ISSUER, "a"));
    store.set(jira, grant(ATLASSIAN_ISSUER, "b"));
    expect((await host.disconnect("linear")).status).toBe("missing");
    expect(store.has(linear)).toBe(false);
    expect(store.has(jira)).toBe(true);
  });

  it("writes nothing back to the Keychain when the grant did not change", async () => {
    const { host, store, writes, grant } = setup();
    store.set(
      hostedAccount("amun", HOSTED_PROVIDERS.linear),
      grant(LINEAR_ISSUER, "a"),
    );
    await host.use("linear", async (session) => session.tools.length);
    expect(writes).toEqual([]);
  });
});
