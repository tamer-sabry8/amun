import { describe, expect, it } from "vitest";
import {
  healthResponse,
  nativePiEvent,
  workspaceSnapshot,
} from "@amun/contracts";
import { workEvent } from "../../contracts/src/work.ts";
import { authEvent } from "../../contracts/src/auth.ts";
import {
  traceBundle,
  traceBundleFailed,
} from "../../contracts/src/diagnostics.ts";
import {
  crewInventory,
  crewObservation,
  crewRoster,
  crewSessionText,
} from "../../contracts/src/crew.ts";
import type { AmunTransport } from "../src/daemon/amun-client.ts";
import { ContractAdapter } from "../src/daemon/contract-adapter.ts";
import { openWorkStore } from "../../work-store/src/index.ts";

class FakeDaemon implements AmunTransport {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  traceFails = false;
  spaces = [{ slug: "alpha", name: "Alpha" }];
  // The daemon's real work store, in memory.
  work = openWorkStore(":memory:").store;
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
    if (method === "work.snapshot") return this.work.snapshot() as T;
    if (method === "work.command")
      return this.work.handle({
        ...(params.command as object),
        version: 1,
        kind: "work",
      }) as T;
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
          {
            id: "product-manager",
            current_state: { state: "blocked", detail: "needs pricing tier" },
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
      "trace.history": { asked: true, ledger: false, archive: false },
      "crew.peek": { live: true, text: "running tests\n12 passed" },
      "trace.export": {
        fileName: "amun-trace-1.zip",
        size: 3,
        files: ["manifest.json"],
        base64: "UEsF",
      },
    };
    if (method === "trace.export" && this.traceFails)
      throw new Error("disk full");
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
    adapter: new ContractAdapter(daemon, () => "2026-11-18T00:00:00Z"),
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
    expect(parsed.setup.completed).toBe(true);
    expect(parsed.agents.map((a) => [a.id, a.kind, a.state])).toEqual([
      ["firstmate", "lead", "waiting"],
      ["crew:proto-w1", "temporary", "waiting"],
      ["crew:scout-1", "temporary", "working"],
      ["crew:product-manager", "temporary", "waiting"],
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

  it("keeps groups, work areas and conversations in the daemon's work store", async () => {
    const { adapter } = make();
    const [added, snap] = await adapter.handle({
      version: 1,
      kind: "work",
      action: "add-group",
      name: "Work",
    });
    expect(added).toMatchObject({ kind: "work-result", ok: true });
    const groupId = (added as { ref: string }).ref;
    expect(workEvent.parse(snap)).toMatchObject({
      kind: "work-snapshot",
      groups: [{ id: groupId, name: "Work" }],
    });
    const [created] = await adapter.handle({
      version: 1,
      kind: "work",
      action: "create-area",
      groupId,
      type: "product",
      name: "Product Test 1",
    });
    expect(created).toMatchObject({ ok: true });
    const areaId = (created as { ref: string }).ref;
    const said = await adapter.handle({
      version: 1,
      kind: "work",
      action: "message",
      workAreaId: areaId,
      role: "you",
      text: "Connect to my Azure DevOps",
    });
    const snapshot = workEvent.parse(said.at(-1));
    if (snapshot.kind !== "work-snapshot") throw new Error("expected snapshot");
    expect(snapshot.messages.map((m) => m.text)).toEqual([
      "Connect to my Azure DevOps",
    ]);
    // Firstmate's crew still sits on top of the stored agents.
    expect(snapshot.agents[0]).toMatchObject({ id: "firstmate", kind: "lead" });
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
    // The UI refuses to send without a model, so one is always reported.
    expect(open.model).toBe("pi");
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

  it("answers a diagnostics request with the daemon's trace bundle", async () => {
    const { daemon, adapter } = make();
    const [bundle] = await adapter.handle({
      version: 1,
      kind: "diagnostics",
      id: "d1",
    });
    expect(traceBundle.parse(bundle)).toMatchObject({
      id: "d1",
      fileName: "amun-trace-1.zip",
      history: "asked",
    });
    expect(daemon.calls.map((call) => call.method)).toEqual(
      expect.arrayContaining(["trace.history", "trace.export"]),
    );
    daemon.traceFails = true;
    const [failed] = await adapter.handle({
      version: 1,
      kind: "diagnostics",
      id: "d2",
    });
    expect(traceBundleFailed.parse(failed)).toMatchObject({
      id: "d2",
      message: "disk full",
    });
  });

  it("shows pool secondmates on their cards and asks the First Mate to change the team", async () => {
    const { daemon, adapter } = make();
    const [snapshot] = await adapter.handle({
      version: 1,
      kind: "work",
      action: "snapshot",
    });
    const parsed = workEvent.parse(snapshot);
    if (parsed.kind !== "work-snapshot") throw new Error("expected a snapshot");
    const pm = parsed.agents.find((agent) => agent.role === "Product Manager");
    expect(pm).toMatchObject({ id: "crew:product-manager", state: "waiting" });
    await adapter.handle({
      version: 1,
      kind: "work",
      action: "toggle-agent",
      agentId: "crew:product-manager",
      enabled: false,
    });
    const asked = daemon.calls.filter((call) => call.method === "primary.send");
    expect(String(asked.at(-1)?.params.text)).toContain(
      'retire the "Product Manager" secondmate. First save its open work',
    );
    const edited = await adapter.handle({
      version: 1,
      kind: "work",
      action: "edit-agent",
      agentId: "crew:product-manager",
      change: "cite sources",
    });
    expect(edited[0]).toMatchObject({ kind: "work-result", ok: true });
    expect(
      String(
        daemon.calls.filter((c) => c.method === "primary.send").at(-1)?.params
          .text,
      ),
    ).toContain("cite sources");
  });

  it("lets the captain watch a crewmate, read-only", async () => {
    const { daemon, adapter } = make();
    const [roster, inventory] = await adapter.handle({
      version: 1,
      kind: "crew-list",
    });
    expect(
      crewRoster.parse(roster).members?.map((m) => [m.id, m.state]),
    ).toEqual([
      ["proto-w1", "needs-decision"],
      ["scout-1", "working"],
      ["product-manager", "blocked"],
    ]);
    expect(crewInventory.parse(inventory).tasks).toContain("scout-1");
    const [observed] = await adapter.handle({
      version: 1,
      kind: "crew-observe",
      taskId: "scout-1",
    });
    expect(crewObservation.parse(observed).taskId).toBe("scout-1");
    const [session] = await adapter.handle({
      version: 1,
      kind: "crew-session-read",
      taskId: "scout-1",
    });
    expect(crewSessionText.parse(session)).toMatchObject({
      live: true,
      text: "running tests\n12 passed",
    });
    expect(daemon.calls.find((c) => c.method === "crew.peek")?.params).toEqual({
      space: "alpha",
      taskId: "scout-1",
    });
  });
});
