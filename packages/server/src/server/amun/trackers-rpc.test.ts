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
      handle: async (message: { provider?: string }) => {
        calls.push(message);
        return {
          kind: "tracker-status",
          provider: message.provider ?? "linear",
          status: "ready",
          identity: { user: null, sites: [{ id: "c", name: "acme", url: "https://acme.atlassian.net" }] },
          message: null,
        };
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
    // The finished sign-in reaches the Tools card in its own shape.
    expect(emitted).toEqual([
      { version: 1, kind: "auth-status", id: "jira-mcp", status: "ready", detail: "acme.atlassian.net" },
    ]);
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

  it("delivers verified publication receipts to primary Firstmate after tracker publish", async () => {
    const sent: string[] = [];
    const delivered: unknown[] = [];
    let changed = 0;
    const deps = {
      work: {
        snapshot: () => ({ plans: [{ id: "p1", requestRef: "amun-r-112233445566" }] }),
        handle: () => [{ kind: "work-result", ok: true }],
      },
      workspace: {
        deliverPublicationReceipt: async (input: unknown, send: (p: string) => Promise<string>) => {
          delivered.push(input);
          await send("verified receipt payload");
          return { state: "accepted", deduplicated: false, fingerprint: "abc123" };
        },
      },
      spaces: { list: async () => [{ slug: "default", fmHome: "/tmp/fm" }] },
      primary: {
        send: async (_space: unknown, text: string) => {
          sent.push(text);
          return { reply: "Noted." };
        },
      },
      trackers: {
        owns: (id: string) => id === "p1",
        publish: async () => [{ kind: "work-snapshot" }],
        writes: () => [
          {
            id: "i1",
            destination: "linear",
            state: "created",
            externalId: "TRA-42",
            url: "https://linear.app/issue/TRA-42",
            note: null,
          },
        ],
        recover: async () => [],
        targets: async () => "",
        handle: async () => ({}),
        stop: () => undefined,
      },
      workChanged: () => {
        changed += 1;
      },
      redactor: { text: (v: string) => v },
      trace: { record: () => undefined },
    } as unknown as AmunRpcDeps;

    const handler = new AmunRpcHandler(deps);
    await handler.handleRaw({ id: "10", method: "work.command", command: { action: "approve-plan", planId: "p1" } });
    await settle();
    expect(changed).toBe(1);
    expect(delivered).toHaveLength(1);
    expect(sent).toEqual(["verified receipt payload"]);
  });

  it("keeps async story review pending and files late story-drafts blocks from primary.send", async () => {
    const finished: unknown[] = [];
    const registered: unknown[] = [];
    let changed = 0;
    const deps = {
      work: { snapshot: () => ({}), handle: () => [] },
      workspace: {
        bindStoryReview: (_m: unknown, ref: string, _o: unknown, prompt: string) => ({
          parent: ref,
          messageId: "msg-1",
          prompt,
        }),
        finishStoryReview: (...args: unknown[]) => finished.push(args),
        hasStoryDrafts: () => false,
        registerCrewStoryDrafts: (ref: string, stories: unknown, objectiveId: unknown, version: unknown) => {
          registered.push({ ref, stories, objectiveId, version });
          return { productId: "p1", objectiveId: "o1", version: 1, inserted: 2, alreadyPresent: false };
        },
        author: async (_m: unknown, fn: (m: string, i: string, c: string) => Promise<string>) => {
          await fn("firstmate", "draft", "{}");
          return { kind: "workspace-snapshot" };
        },
      },
      spaces: { get: async () => ({ slug: "default", fmHome: "/tmp/fm" }) },
      primary: {
        send: async (_space: unknown, text: string) => {
          if (text.includes("late-stories")) {
            return {
              reply:
                'Here are the drafts.\n```amun\n{"do":"story-drafts","request":"amun-r-aabbccddeeff","objectiveId":"o1","expectedVersion":1,"stories":[{"title":"S1","requirement":"REQ-1","acceptance":["AC1"],"tasks":["T1"]}]}\n```',
            };
          }
          return { reply: "Dispatched to PRD mate." };
        },
      },
      workChanged: () => {
        changed += 1;
      },
      redactor: { text: (v: string) => v },
      trace: { record: () => undefined },
    } as unknown as AmunRpcDeps;

    const handler = new AmunRpcHandler(deps);
    await handler.handleRaw({
      id: "11",
      method: "workspace.author",
      space: "default",
      ref: "amun-r-aabbccddeeff",
      origin: { areaId: "a1", chatId: null },
      message: {
        version: 1,
        kind: "product-authoring",
        productId: "p1",
        objectiveId: "o1",
        expectedVersion: 1,
        action: "stories",
        model: "firstmate",
        difficulty: "standard",
      },
    });
    expect(finished).toHaveLength(0);

    await handler.handleRaw({
      id: "12",
      method: "primary.send",
      space: "default",
      text: "late-stories",
    });
    expect(registered).toHaveLength(1);
    expect(changed).toBe(1);
  });
});
