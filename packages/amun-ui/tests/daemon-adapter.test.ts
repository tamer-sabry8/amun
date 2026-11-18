import { describe, expect, it } from "vitest";
import {
  healthResponse,
  nativePiEvent,
  workspaceSnapshot,
} from "@amun/contracts";
import { workEvent } from "../../contracts/src/work.ts";
import { authEvent } from "../../contracts/src/auth.ts";
import type { AmunTransport } from "../src/daemon/amun-client.ts";
import {
  ContractAdapter,
  memorySetupStore,
} from "../src/daemon/contract-adapter.ts";

class FakeDaemon implements AmunTransport {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  spaces = [{ slug: "alpha", name: "Alpha" }];
  connections = [
    {
      id: "ado-1",
      kind: "ado",
      baseUrl: "https://devops.example.com/Collection/",
      status: "ready",
      user: "Tamer",
      projects: [{ id: "p", name: "ICV" }],
      message: null,
    },
  ];
  async request<T>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    this.calls.push({ method, params });
    const results: Record<string, unknown> = {
      "spaces.list": this.spaces,
      "spaces.create": { slug: "beta", name: String(params.name) },
      "fleet.snapshot": {
        tasks: [
          {
            id: "proto-w1",
            kind: "prototype",
            current_state: { state: "needs-decision", detail: "waiting" },
          },
          {
            id: "scout-1",
            current_state: { state: "working", detail: "reading interviews" },
          },
        ],
      },
      "holds.list": [
        {
          source: "crew",
          taskId: "proto-w1",
          key: "layout",
          verb: "needs-decision",
          summary: "One page?",
        },
      ],
      "holds.answer": { reply: "Aye." },
      "primary.start": { agentId: "fm" },
      "primary.send": { reply: "Aye, Captain." },
      "connections.list": this.connections,
      "connections.save": this.connections[0],
    };
    if (method === "connections.save" && params.secret === "bad")
      throw new Error("Azure DevOps refused the token.");
    return results[method] as T;
  }
  onEvent(): () => void {
    return () => {};
  }
  onStatus(): () => void {
    return () => {};
  }
}

const make = () => {
  const daemon = new FakeDaemon();
  return {
    daemon,
    adapter: new ContractAdapter(
      daemon,
      memorySetupStore(),
      () => "2026-11-18T00:00:00Z",
    ),
  };
};

describe("daemon contract adapter", () => {
  it("answers health and builds valid workspace and work snapshots", async () => {
    const { adapter } = make();
    const [health] = await adapter.handle({
      version: 1,
      id: "h",
      method: "health",
      params: {},
    });
    expect(healthResponse.parse(health).status).toBe("ready");

    const [workspace] = await adapter.handle({
      version: 1,
      kind: "workspace",
      action: "snapshot",
    });
    expect(workspaceSnapshot.parse(workspace).products).toEqual([
      { id: "alpha", name: "Alpha" },
    ]);

    const [work] = await adapter.handle({
      version: 1,
      kind: "work",
      action: "snapshot",
    });
    const parsed = workEvent.parse(work);
    if (parsed.kind !== "work-snapshot") throw new Error("expected a snapshot");
    expect(parsed.groups).toEqual([
      { id: "alpha", name: "Alpha", position: 0 },
    ]);
    expect(parsed.agents.map((a) => [a.id, a.kind, a.state])).toEqual([
      ["firstmate", "lead", "waiting"],
      ["crew:proto-w1", "temporary", "waiting"],
      ["crew:scout-1", "temporary", "working"],
    ]);
    expect(parsed.attention).toMatchObject([
      { kind: "question", title: "One page?", groupId: null },
    ]);
  });

  it("routes an attention answer to holds.answer with the original hold", async () => {
    const { adapter, daemon } = make();
    await adapter.handle({ version: 1, kind: "work", action: "snapshot" });
    const [result] = await adapter.handle({
      version: 1,
      kind: "work",
      action: "resolve-attention",
      attentionId: "hold:proto-w1:layout",
      resolution: "answer",
      answer: "One page",
    });
    expect(result).toMatchObject({ kind: "work-result", ok: true });
    expect(
      daemon.calls.find((c) => c.method === "holds.answer")?.params,
    ).toMatchObject({
      space: "alpha",
      hold: { source: "crew", key: "layout" },
      answer: "One page",
    });
  });

  it("creates a Product Space for add-group", async () => {
    const { adapter, daemon } = make();
    const [result] = await adapter.handle({
      version: 1,
      kind: "work",
      action: "add-group",
      name: "Beta",
    });
    expect(result).toMatchObject({ ok: true, ref: "beta" });
    expect(daemon.calls.some((c) => c.method === "spaces.create")).toBe(true);
  });

  it("talks to the First Mate through the conversation contract", async () => {
    const { adapter, daemon } = make();
    const [opened] = await adapter.handle({
      version: 1,
      kind: "native-pi",
      action: "run",
      id: "o",
      command: "conversation",
      argument: "",
    });
    const open = nativePiEvent.parse(opened).result;
    if (open.kind !== "conversation")
      throw new Error("expected a conversation");
    const [sent] = await adapter.handle({
      version: 1,
      kind: "native-pi",
      action: "run",
      id: "s",
      command: "conversation-send",
      argument: JSON.stringify({
        sessionId: open.sessionId,
        model: null,
        text: "Status?",
      }),
    });
    const reply = nativePiEvent.parse(sent).result;
    expect(reply).toMatchObject({
      kind: "conversation",
      replyCount: 1,
      latestReply: "Aye, Captain.",
    });
    expect(
      daemon.calls.filter((c) => c.method === "primary.start"),
    ).toHaveLength(1);
    expect(
      daemon.calls.find((c) => c.method === "primary.send")?.params,
    ).toEqual({ space: "alpha", text: "Status?" });

    const [other] = await adapter.handle({
      version: 1,
      kind: "native-pi",
      action: "run",
      id: "x",
      command: "export",
      argument: "",
    });
    expect(nativePiEvent.parse(other).result.kind).toBe("message");
  });

  it("connects Azure DevOps through the daemon and reports what it can read", async () => {
    const { adapter, daemon } = make();
    const connection = {
      kind: "ado",
      baseUrl: "https://devops.example.com/Collection",
    };
    const replies = await adapter.handle({
      version: 1,
      kind: "auth",
      action: "save",
      connection,
      secret: "x".repeat(52),
    });
    for (const reply of replies) authEvent.parse(reply);
    expect(replies[0]).toMatchObject({
      kind: "auth-notice",
      message: expect.stringContaining("as Tamer. It can read 1 project: ICV"),
    });
    expect(replies[1]).toMatchObject({
      kind: "auth-connections",
      connections: [{ id: "ado-1", status: "ready" }],
    });
    expect(daemon.calls.at(-2)).toMatchObject({
      method: "connections.save",
      params: { connection },
    });

    const refused = await adapter.handle({
      version: 1,
      kind: "auth",
      action: "save",
      connection,
      secret: "bad",
    });
    expect(refused[0]).toMatchObject({
      kind: "auth-notice",
      message: "Azure DevOps refused the token.",
    });
  });
});
