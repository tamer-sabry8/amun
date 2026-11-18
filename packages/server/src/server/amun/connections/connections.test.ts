import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adoCollectionUrl, patIsWellFormed, probeAdo, type FetchLike } from "./ado-probe.js";
import { ConnectionStore, connectionId } from "./connection-store.js";
import { memorySecretStore } from "./secret-store.js";

const GOOD_PAT = "a".repeat(52);
const COLLECTION = "https://devops.example.com/TahalufCollection/";

/** A stand-in Azure DevOps Server 2022 that knows one token. */
function fakeAdo(calls: string[] = []): FetchLike {
  return async (url, init) => {
    calls.push(url);
    const auth = (init.headers as Record<string, string>).Authorization;
    if (auth !== `Basic ${Buffer.from(`:${GOOD_PAT}`).toString("base64")}`) {
      return new Response("", { status: 401 });
    }
    if (!url.startsWith(COLLECTION)) return new Response("", { status: 404 });
    if (url.includes("_apis/projects")) {
      return Response.json({ count: 2, value: [{ id: "p1", name: "ICV" }, { id: "p2", name: "Payments" }] });
    }
    if (url.includes("_apis/connectionData")) {
      return Response.json({ authenticatedUser: { providerDisplayName: "Tamer Sabry" } });
    }
    return new Response("", { status: 404 });
  };
}

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "amun-conn-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("Azure DevOps probe", () => {
  it("normalises collection URLs and refuses unsafe ones", () => {
    expect(adoCollectionUrl("https://devops.example.com/TahalufCollection")).toBe(COLLECTION);
    expect(() => adoCollectionUrl("http://devops.example.com/c")).toThrow("https");
    expect(() => adoCollectionUrl("https://me:pw@devops.example.com/c")).toThrow();
  });

  it("checks token shape before any network call", () => {
    expect(patIsWellFormed(GOOD_PAT)).toBe(true);
    expect(patIsWellFormed("short")).toBe(false);
    expect(patIsWellFormed(`${GOOD_PAT} `)).toBe(false);
  });

  it("reads projects and the signed-in user over API 7.0", async () => {
    const calls: string[] = [];
    const result = await probeAdo({ collectionUrl: COLLECTION, pat: GOOD_PAT, fetch: fakeAdo(calls) });
    expect(result).toEqual({
      ok: true,
      user: "Tamer Sabry",
      projects: [
        { id: "p1", name: "ICV" },
        { id: "p2", name: "Payments" },
      ],
    });
    expect(calls.every((url) => url.includes("api-version=7.0"))).toBe(true);
  });

  it("explains a refused token and an unreachable server", async () => {
    expect(await probeAdo({ collectionUrl: COLLECTION, pat: "b".repeat(52), fetch: fakeAdo() })).toMatchObject({
      ok: false,
      reason: "unauthorized",
    });
    const offline: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect(await probeAdo({ collectionUrl: COLLECTION, pat: GOOD_PAT, fetch: offline })).toMatchObject({
      ok: false,
      reason: "unreachable",
    });
  });
});

describe("Connection store", () => {
  it("keeps the token only in the secret store after a successful check", async () => {
    const secrets = memorySecretStore();
    const store = new ConnectionStore(tmp, secrets, { fetch: fakeAdo() });
    const saved = await store.save({ kind: "ado", baseUrl: "https://devops.example.com/TahalufCollection" }, GOOD_PAT);

    expect(saved).toMatchObject({ kind: "ado", baseUrl: COLLECTION, status: "ready", user: "Tamer Sabry" });
    expect(saved.projects.map((p) => p.name)).toEqual(["ICV", "Payments"]);
    expect([...secrets.values.values()]).toEqual([GOOD_PAT]);
    const file = readFileSync(path.join(tmp, "connections.json"), "utf8");
    expect(file).not.toContain(GOOD_PAT);
    expect(file).toContain(COLLECTION);
  });

  it("refuses a bad token without saving anything", async () => {
    const secrets = memorySecretStore();
    const store = new ConnectionStore(tmp, secrets, { fetch: fakeAdo() });
    await expect(store.save({ kind: "ado", baseUrl: COLLECTION }, "c".repeat(52))).rejects.toThrow(
      "refused the token",
    );
    await expect(store.save({ kind: "ado", baseUrl: COLLECTION }, "not a token")).rejects.toThrow(
      "personal access token",
    );
    expect(secrets.values.size).toBe(0);
    expect(existsSync(path.join(tmp, "connections.json"))).toBe(false);
  });

  it("re-checks, reports a missing token, and forgets", async () => {
    const secrets = memorySecretStore();
    const store = new ConnectionStore(tmp, secrets, { fetch: fakeAdo() });
    const connection = { kind: "ado" as const, baseUrl: COLLECTION };
    await store.save(connection, GOOD_PAT);

    const fresh = new ConnectionStore(tmp, secrets, { fetch: fakeAdo() });
    expect((await fresh.list())[0]?.status).toBe("configured");
    expect((await fresh.check(connection)).status).toBe("ready");

    secrets.values.clear();
    expect((await fresh.check(connection)).status).toBe("missing");

    await fresh.forget(connection);
    expect(await fresh.list()).toEqual([]);
  });

  it("gives each endpoint one stable id, with or without a trailing slash", () => {
    expect(connectionId({ kind: "ado", baseUrl: COLLECTION })).toMatch(/^ado-[0-9a-f]{32}$/);
    expect(connectionId({ kind: "ado", baseUrl: COLLECTION })).toBe(
      connectionId({ kind: "ado", baseUrl: COLLECTION.replace(/\/$/, "") }),
    );
  });
});
