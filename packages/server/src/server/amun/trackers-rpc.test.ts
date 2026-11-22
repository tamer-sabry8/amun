import { describe, expect, it } from "vitest";
import { AmunRpcHandler, type AmunRpcDeps } from "./amun-rpc-handler.js";

function handlerWith(owned: Set<string>) {
  const calls: unknown[] = [];
  const published: string[] = [];
  const emitted: unknown[] = [];
  let changed = 0;
  const ado: string[] = [];
  const deps = {
    work: { snapshot: () => ({}), handle: (command: unknown) => [{ kind: "work-result", ok: true, command }] },
    connections: {
      save: async () => {
        ado.push("save");
        return { kind: "ado" };
      },
      check: async () => ({ kind: "ado" }),
      forget: async () => undefined,
    },
    trackers: {
      handle: async (message: unknown) => {
        calls.push(message);
        return { kind: "tracker-status", provider: "linear", status: "ready", identity: null, message: null };
      },
      owns: (planId: string) => owned.has(planId),
      publish: async (planId: string) => {
        published.push(planId);
        return [{ kind: "work-snapshot" }];
      },
      recover: async () => [],
      targets: async () => "",
      stop: () => undefined,
    },
    emit: (message: unknown) => emitted.push(message),
    workChanged: () => {
      changed += 1;
    },
    redactor: { text: (value: string) => value },
    trace: { record: () => undefined },
  } as unknown as AmunRpcDeps;
  return { handler: new AmunRpcHandler(deps), calls, published, emitted, ado, changed: () => changed };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Linear and Jira over Amun RPC", () => {
  it("starts a browser sign-in for connections.save without any secret, and answers at once", async () => {
    const { handler, calls, emitted, ado } = handlerWith(new Set());
    const response = await handler.handleRaw({
      id: "1",
      method: "connections.save",
      connection: { kind: "jira", baseUrl: "https://mcp.atlassian.com/v2/mcp" },
    });
    expect(response).toMatchObject({ ok: true, result: { kind: "tracker-status", status: "checking" } });
    await settle();
    expect(calls).toEqual([{ action: "connect", provider: "jira" }]);
    expect(emitted).toEqual([expect.objectContaining({ kind: "tracker-status", status: "ready" })]);
    expect(ado).toEqual([]);
  });

  it("routes check and forget to the tracker, and still needs a token for Azure DevOps", async () => {
    const { handler, calls } = handlerWith(new Set());
    for (const method of ["connections.check", "connections.forget"])
      await handler.handleRaw({ id: "2", method, connection: { kind: "linear", baseUrl: "https://mcp.linear.app/mcp" } });
    expect(calls).toEqual([
      { action: "check", provider: "linear" },
      { action: "disconnect", provider: "linear" },
    ]);
    const noToken = await handler.handleRaw({
      id: "3",
      method: "connections.save",
      connection: { kind: "ado", baseUrl: "https://dev.azure.com/acme" },
    });
    expect(noToken).toMatchObject({ ok: false });
  });

  it("publishes a Linear or Jira plan right after the captain approves it, and nothing else", async () => {
    const { handler, published, changed } = handlerWith(new Set(["plan-jira"]));
    await handler.handleRaw({ id: "4", method: "work.command", command: { action: "approve-plan", planId: "plan-jira", fingerprint: "f" } });
    await handler.handleRaw({ id: "5", method: "work.command", command: { action: "approve-plan", planId: "plan-ado", fingerprint: "f" } });
    await handler.handleRaw({ id: "6", method: "work.command", command: { action: "propose-plan", planId: "plan-jira" } });
    await settle();
    expect(published).toEqual(["plan-jira"]);
    expect(changed()).toBe(1);
  });

  it("checks or retries an approved plan through trackers.request publish", async () => {
    const { handler, published } = handlerWith(new Set(["p1"]));
    expect(
      await handler.handleRaw({ id: "7", method: "trackers.request", message: { action: "publish", planId: "p1", retry: true } }),
    ).toMatchObject({ ok: true, result: { handled: true } });
    expect(
      await handler.handleRaw({ id: "8", method: "trackers.request", message: { action: "publish", planId: "other" } }),
    ).toMatchObject({ ok: true, result: { handled: false } });
    await settle();
    expect(published).toEqual(["p1"]);
  });

  it("rejects an unknown provider at the schema", async () => {
    const { handler } = handlerWith(new Set());
    expect(
      await handler.handleRaw({ id: "9", method: "trackers.request", message: { action: "connect", provider: "asana" } }),
    ).toMatchObject({ ok: false, error: { code: "InvalidRequest" } });
  });
});
