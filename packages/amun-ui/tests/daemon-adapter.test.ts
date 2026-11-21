import { describe, expect, it } from "vitest";
import {
  healthResponse,
  nativePiEvent,
  workspaceSnapshot,
} from "@amun/contracts";
import { councilStatus, workEvent } from "../../contracts/src/work.ts";
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
import {
  crewName,
  plainCrewDetail,
  poolRegistrationRequest,
  ContractAdapter,
  heldUntil,
  holdId,
  holdAttention,
  fleetAgents,
  holdsDue,
  holdSignature,
  settleHoldAnswers,
  type HoldAnswer,
} from "../src/daemon/contract-adapter.ts";
import { openWorkStore } from "../../work-store/src/index.ts";

class FakeDaemon implements AmunTransport {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  traceFails = false;
  /** What Pi offers; null stands for a daemon that cannot say. */
  models: {
    current: string | null;
    models: { id: string; label: string }[];
  } | null = null;
  signedIn = ["github-copilot"];
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
      "work.search": {
        hits: [
          {
            kind: "message",
            id: "m1",
            title: "Customer Insights Portal",
            snippet: [{ text: "pricing", match: true }],
            workAreaId: "w1",
            role: "you",
            at: "2026-11-19T10:41:00.000Z",
          },
        ],
        steps: [
          {
            turnId: "t1",
            stepId: "s4",
            workAreaId: "w1",
            words: "started a secondmate in its own worktree",
            script: "fm-spawn --secondmate",
            at: "2026-11-19T10:42:06.000Z",
          },
        ],
      },
      "happened.read": {
        available: true,
        turns: [
          {
            id: "t1",
            trigger: "you",
            prompt: "Draft three pricing options.",
            at: "2026-11-19T10:41:00.000Z",
            durationMs: 12000,
            workAreaId: "w1",
            steps: [
              {
                id: "s4",
                kind: "action",
                words: "started a secondmate in its own worktree",
                script: "fm-spawn --secondmate",
                at: "2026-11-19T10:42:06.000Z",
                durationMs: 4000,
                sent: "bin/fm-spawn.sh --secondmate pricing-options",
                cameBack: "started",
                failed: false,
              },
            ],
          },
        ],
      },
      "primary.once": { asked: true },
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
    if (method === "models.list") {
      if (!this.models) throw new Error("no models");
      return this.models as T;
    }
    if (method === "primary.setModel") {
      if (!this.models?.models.some((model) => model.id === params.model))
        throw new Error("Pi does not offer that model.");
      this.models = { ...this.models, current: String(params.model) };
      return { model: params.model } as T;
    }
    if (method === "notion.request")
      return [
        {
          version: 1,
          kind: "auth-status",
          id: "notion-mcp",
          status: "checking",
        },
      ] as T;
    if (method === "council.request") {
      const message = params.message as { action: string };
      const status = {
        version: 1,
        kind: "council-status",
        installed: true,
        commit: "e40f40652d5690c4d9f928c4794c673a99f2cd0e",
        previous: null,
        repo: null,
        claude: true,
        seats: [{ key: "skeptic", name: "The Skeptic", disabled: false }],
        roomUrl: null,
        message: "",
      };
      if (message.action !== "run") return [status] as T;
      return [
        {
          version: 1,
          kind: "work-result",
          action: "council-run",
          ok: true,
          message: "",
          ref: "session-1",
          step: null,
        },
        this.work.snapshot(),
        status,
      ] as T;
    }
    if (method === "accounts.check")
      return {
        provider: params.provider,
        status: this.signedIn.includes(String(params.provider))
          ? "ready"
          : "missing",
        reason: null,
      } as T;
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

  it("asks Firstmate to close a task marked done, or put it off to a day", async () => {
    const asked = async (extra: Record<string, unknown>) => {
      const { adapter, daemon } = make();
      await adapter.handle({ version: 1, kind: "work", action: "snapshot" });
      const [result] = await adapter.handle({
        version: 1,
        kind: "work",
        action: "resolve-attention",
        attentionId: "hold:proto-w1:layout",
        ...extra,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      return {
        result,
        sent: daemon.calls.find((c) => c.method === "holds.answer")?.params
          .answer,
      };
    };
    const done = await asked({ resolution: "done" });
    expect(done.result).toMatchObject({ ok: true });
    expect(String(done.sent)).toMatch(
      /done and no longer needed.*close the task/,
    );
    const later = await asked({ resolution: "snooze", until: "2026-11-23" });
    expect(later.result).toMatchObject({ ok: true });
    expect(String(later.sent)).toMatch(
      /Remind the captain on 2026-11-23.*--until 2026-11-23/,
    );
    // Snooze with no day sends nothing: Firstmate keeps the hold.
    const none = await asked({ resolution: "snooze" });
    expect(none.result).toMatchObject({ ok: false });
    expect(none.sent).toBeUndefined();
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
    expect(daemon.calls.some((c) => c.method === "models.list")).toBe(false);
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

  it("lists the models Pi offers and switches the First Mate to the one chosen", async () => {
    const { adapter, daemon } = make();
    daemon.models = {
      current: "github-copilot/claude-sonnet-5",
      models: [
        { id: "github-copilot/claude-sonnet-5", label: "Claude Sonnet 5" },
        { id: "openai-codex/gpt-5", label: "GPT-5" },
      ],
    };
    const run = async (command: string, argument: string) => {
      const [event] = await adapter.handle({
        version: 1,
        kind: "native-pi",
        action: "run",
        id: command,
        command,
        argument,
      });
      return nativePiEvent.parse(event).result;
    };

    // The prompt box reads the model before any conversation is open.
    const saved = await run("default-model", "");
    expect(saved.kind === "message" && JSON.parse(saved.text)).toEqual({
      model: "github-copilot/claude-sonnet-5",
    });
    expect(daemon.calls.some((c) => c.method === "primary.start")).toBe(false);

    const listed = await run("model", "");
    expect(listed).toMatchObject({
      kind: "choices",
      choices: daemon.models.models,
    });

    // The picker looks for the chosen id in the reply.
    const chosen = await run("model", "openai-codex/gpt-5");
    expect(chosen.kind === "message" && chosen.text).toContain(
      "openai-codex/gpt-5",
    );
    expect(
      daemon.calls.find((c) => c.method === "primary.setModel")?.params,
    ).toEqual({ space: "alpha", model: "openai-codex/gpt-5" });
    const open = await run("conversation", "");
    expect(open.kind === "conversation" && open.model).toBe(
      "openai-codex/gpt-5",
    );

    const refused = await run("model", "nope/unknown");
    expect(refused.kind === "message" && refused.text).not.toContain(
      "nope/unknown",
    );
  });

  it("reports each model sign-in as Pi sees it, and never claims a sign-in it cannot do", async () => {
    const { adapter } = make();
    const ask = async (action: string, provider: string) =>
      (
        await adapter.handle({
          version: 1,
          kind: "auth",
          action,
          provider,
          ...(action === "login" ? { type: "oauth" } : {}),
        })
      ).map((event) => authEvent.parse(event));

    // A stored sign-in walks "checking" then "configured": shown as Signed in.
    expect(await ask("readiness", "github-copilot")).toEqual([
      {
        version: 1,
        kind: "auth-status",
        id: "github-copilot",
        status: "checking",
      },
      {
        version: 1,
        kind: "auth-status",
        id: "github-copilot",
        status: "configured",
      },
    ]);
    expect(await ask("readiness", "xai")).toEqual([
      { version: 1, kind: "auth-status", id: "xai", status: "missing" },
    ]);
    const [notice, status] = await ask("login", "xai");
    expect(notice).toMatchObject({ kind: "auth-notice" });
    expect(status).toMatchObject({ id: "xai", status: "missing" });
  });

  it("passes the Council to the daemon and keeps the First Mate over its work snapshot", async () => {
    const { adapter, daemon } = make();
    const [status] = await adapter.handle({
      version: 1,
      kind: "council",
      action: "status",
    });
    expect(councilStatus.parse(status).seats).toEqual([
      { key: "skeptic", name: "The Skeptic", disabled: false },
    ]);

    const [result, snapshot, after] = await adapter.handle({
      version: 1,
      kind: "council",
      action: "run",
      text: "/council Should we ship in June?",
      workAreaId: null,
      groupId: null,
    });
    expect(result).toMatchObject({ action: "council-run", ok: true });
    // The snapshot is the adapter's own: Firstmate stays the lead on it.
    const parsed = workEvent.parse(snapshot);
    expect(
      parsed.kind === "work-snapshot" &&
        parsed.agents.some((agent) => agent.kind === "lead"),
    ).toBe(true);
    expect(councilStatus.parse(after).installed).toBe(true);
    expect(
      daemon.calls.filter((c) => c.method === "council.request"),
    ).toHaveLength(2);
  });

  it("sends Notion sign-in and linked-memory commands to the daemon, and nothing else", async () => {
    const { adapter, daemon } = make();
    const [status] = await adapter.handle({
      version: 1,
      kind: "auth",
      action: "notion-connect",
      browser: "edge",
    });
    expect(authEvent.parse(status)).toMatchObject({
      id: "notion-mcp",
      status: "checking",
    });
    await adapter.handle({
      version: 1,
      kind: "workspace",
      productId: "p",
      action: "sync-memory-field",
      link: "l",
      choice: "refresh",
      review: {},
    });
    expect(
      daemon.calls
        .filter((c) => c.method === "notion.request")
        .map((c) => (c.params.message as { action: string }).action),
    ).toEqual(["notion-connect", "sync-memory-field"]);

    // Other workspace commands keep going to the workspace service.
    await adapter.handle({ version: 1, kind: "workspace", action: "snapshot" });
    expect(
      daemon.calls.filter((c) => c.method === "notion.request"),
    ).toHaveLength(2);
  });

  it("passes Firstmate's own skills to the First Mate and refuses the ones Amun must not run", async () => {
    const { adapter, daemon } = make();
    const run = async (command: string, argument = "") => {
      const [event] = await adapter.handle({
        version: 1,
        kind: "native-pi",
        action: "run",
        id: command,
        command,
        argument,
      });
      const result = nativePiEvent.parse(event).result;
      return result.kind === "message" ? result.text : "";
    };
    expect(await run("bearings", "include PRs")).toBe("Aye, Captain.");
    expect(
      daemon.calls.find((c) => c.method === "primary.send")?.params,
    ).toEqual({ space: "alpha", text: "/skill:bearings include PRs" });

    // /stow must run on this Mac only, so it is never sent to the First Mate.
    expect(await run("stow")).toMatch(/does not save session notes/);
    // An update is never run on the working home from here.
    expect(await run("updatefirstmate")).toMatch(/switched off/);
    expect(await run("calm")).toBe("Amun already shows the calm view.");
    expect(
      daemon.calls.filter((c) => c.method === "primary.send"),
    ).toHaveLength(1);
  });

  it("asks the First Mate to save the supervision model; never writes it", async () => {
    const { adapter, daemon } = make();
    daemon.models = {
      current: "github-copilot/claude-sonnet-5.5",
      models: [
        { id: "github-copilot/claude-sonnet-5.5", label: "Claude Sonnet 5.5" },
        { id: "github-copilot/claude-haiku-5.5", label: "Claude Haiku 5.5" },
      ],
    };
    const run = async (argument: string) => {
      const [event] = await adapter.handle({
        version: 1,
        kind: "native-pi",
        action: "run",
        id: "s" + argument,
        command: "supervision-model",
        argument,
      });
      const result = nativePiEvent.parse(event).result;
      return result.kind === "message" ? result.text : "";
    };
    const sent = () =>
      daemon.calls
        .filter((c) => c.method === "primary.send")
        .map((c) => String(c.params.text));
    expect(await run("")).toMatch(/type `\/supervision-model`/);
    expect(await run("claude")).toMatch(/Several models match/);
    expect(await run("gpt")).toMatch(/No model matches/);
    expect(sent()).toEqual([]);

    expect(await run("haiku")).toBe("Aye, Captain.");
    expect(sent()[0]).toContain("github-copilot/claude-haiku-5.5");
    expect(sent()[0]).toContain("config/supervision-branch-model");
    await run("follow main");
    expect(sent()[1]).toMatch(/follow the main conversation's model/);
  });

  it("hands a delegated job to the First Mate to dispatch through Firstmate, and keeps its answer", async () => {
    const { adapter, daemon } = make();
    await adapter.handle({ version: 1, kind: "work", action: "snapshot" });
    const [created] = await adapter.handle({
      version: 1,
      kind: "work",
      action: "create-area",
      groupId: adapter.work().groups[0]!.id,
      type: "task",
      name: "Pricing review",
    });
    const areaId = String((created as { ref: string }).ref);
    let changed = 0;
    adapter.onChange = () => (changed += 1);
    const replies = await adapter.handle({
      version: 1,
      kind: "work-delegate",
      workAreaId: areaId,
      agent: "Product Manager",
      title: "Pricing options",
      task: "Draft three pricing options for the owner.",
    });
    // Nothing is started here and nothing is claimed.
    expect(replies).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const asked = daemon.calls.filter((c) => c.method === "primary.send");
    expect(asked).toHaveLength(1);
    const text = String(asked[0]!.params.text);
    expect(text).toContain("Pricing options");
    expect(text).toContain("fm-spawn");
    expect(text).toContain("Do not do the work yourself");
    expect(text).toContain("Draft three pricing options for the owner.");
    const kept = daemon.work
      .snapshot()
      .messages.filter((m) => m.workAreaId === areaId);
    expect(kept.map((m) => [m.role, m.text])).toEqual([
      ["firstmate", "Aye, Captain."],
    ]);
    expect(changed).toBeGreaterThan(0);
  });

  it("ignores a delegation that does not match the contract", async () => {
    const { adapter, daemon } = make();
    expect(
      await adapter.handle({ version: 1, kind: "work-delegate", task: "" }),
    ).toEqual([]);
    expect(daemon.calls.filter((c) => c.method === "primary.send")).toEqual([]);
  });

  it("shows an answered hold under Done at once, and reopens it if the answer did not land", async () => {
    const { adapter, daemon } = make();
    await adapter.handle({ version: 1, kind: "work", action: "snapshot" });
    const open = adapter
      .work()
      .attention.find((item) => item.id.startsWith("hold:"))!;
    let changed = 0;
    adapter.onChange = () => (changed += 1);
    const failing = daemon.request.bind(daemon);
    daemon.request = (async (
      method: string,
      params?: Record<string, unknown>,
    ) => {
      if (method === "holds.answer") throw new Error("Firstmate took too long");
      return failing(method, params);
    }) as typeof daemon.request;

    const [result, snapshot] = await adapter.handle({
      version: 1,
      kind: "work",
      action: "resolve-attention",
      attentionId: open.id,
      resolution: "answer",
      answer: "One page",
    });
    expect(result).toMatchObject({ ok: true });
    expect(String((result as { message: string }).message)).toContain(
      "One page",
    );
    const taken = workEvent.parse(snapshot);
    if (taken.kind !== "work-snapshot") throw new Error("expected a snapshot");
    expect(taken.attention.find((item) => item.id === open.id)).toMatchObject({
      state: "done",
      answer: "One page",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changed).toBeGreaterThan(0);
    const after = adapter.work().attention.find((item) => item.id === open.id)!;
    expect(after.state).toBe("open");
    expect(after.detail).toContain("did not reach Firstmate");
  });

  it("never shows a task held again as already answered", () => {
    const hold = {
      source: "backlog" as const,
      taskId: "moca-pilot-group",
      title: "Decide who is in the pilot group",
      reason: "Captain reminder",
      until: "2026-11-07",
    };
    const id = holdId(hold);
    const answered = (): HoldAnswer => ({
      signature: holdSignature(hold),
      title: hold.title,
      answer: "Ministers only",
      at: "2026-11-18T00:00:00Z",
      status: "recorded",
    });

    // Still held, same question: the answer stands.
    const same = new Map([[id, answered()]]);
    settleHoldAnswers(same, [hold]);
    expect(same.get(id)?.answer).toBe("Ministers only");

    // Firstmate cleared it; it stays under Done for this run.
    settleHoldAnswers(same, []);
    expect(same.get(id)?.cleared).toBe(true);
    // The same task is held again: a fresh question, not an answered one.
    settleHoldAnswers(same, [hold]);
    expect(same.has(id)).toBe(false);

    // Held again with different words, without ever being seen cleared.
    const changed = new Map([[id, answered()]]);
    settleHoldAnswers(changed, [{ ...hold, reason: "Now needs a date" }]);
    expect(changed.has(id)).toBe(false);

    // An answer still on its way is never dropped by a hold that is missing.
    const sending = new Map([
      [id, { ...answered(), status: "sending" as const }],
    ]);
    settleHoldAnswers(sending, []);
    expect(sending.get(id)?.cleared).toBeUndefined();
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

describe("search and What happened", () => {
  it("answers the palette with conversation words and Firstmate's steps", async () => {
    const { adapter, daemon } = make();
    const [reply] = await adapter.handle({
      version: 1,
      kind: "content-search",
      requestId: "r1",
      query: "pricing",
    });
    const event = workEvent.parse(reply);
    if (event.kind !== "content-search-result") throw new Error(event.kind);
    expect(event.hits.map((hit) => [hit.kind, hit.id, hit.workAreaId])).toEqual(
      [
        ["message", "m1", "w1"],
        ["step", "s4", "w1"],
      ],
    );
    expect(event.hits[1]).toMatchObject({
      title: "started a secondmate in its own worktree",
      script: "fm-spawn --secondmate",
    });
    // Reading never sends the First Mate anything.
    expect(daemon.calls.map((call) => call.method)).toEqual(["work.search"]);
  });

  it("reads one conversation's turns and steps without starting anything", async () => {
    const { adapter, daemon } = make();
    const [reply] = await adapter.handle({
      version: 1,
      kind: "what-happened",
      requestId: "r2",
      workAreaId: "w1",
    });
    const event = workEvent.parse(reply);
    if (event.kind !== "what-happened-result") throw new Error(event.kind);
    expect(event.available).toBe(true);
    expect(event.turns[0]!.steps[0]!.script).toBe("fm-spawn --secondmate");
    expect(daemon.calls).toEqual([
      { method: "happened.read", params: { workAreaId: "w1" } },
    ]);
  });
});

describe("Firstmate's crew in plain words", () => {
  it("names a crewmate and explains a missed request without Firstmate's own codes", () => {
    expect(crewName("saas-devops")).toBe("Saas Devops");
    const plain = plainCrewDetail(
      "pending-reply-missed: task=researcher pending-reply-id=a6a0e2dd2b57aa69 request=Captain note: try the connection.",
    );
    expect(plain).toMatch(
      /^Has not answered Firstmate’s last request: “Captain note: try the connection.”/,
    );
    expect(plain).not.toMatch(/pending-reply|task=/);
    expect(plainCrewDetail("no current-state source recorded")).toBe(
      "Nothing to report yet.",
    );
    expect(
      plainCrewDetail(
        "blocked [key=k1] [at=1795110838]: waiting on the hooks prompt",
      ),
    ).toBe("waiting on the hooks prompt");
  });

  it("asks Firstmate once to register all twenty agents as second mates", async () => {
    const text = poolRegistrationRequest();
    expect(text).toMatch(/registered second mates/);
    expect(text).toMatch(/do not create a duplicate/);
    expect(
      text.split("\n").filter((line) => line.startsWith("- ")),
    ).toHaveLength(20);
    expect(text.length).toBeLessThan(32000);
  });
});

describe("registering the agents with Firstmate", () => {
  it("asks once, after the First Mate has answered a message", async () => {
    const { adapter, daemon } = make();
    const once = () =>
      daemon.calls.filter((call) => call.method === "primary.once");
    await adapter.handle({ version: 1, kind: "work", action: "snapshot" });
    expect(once()).toEqual([]);
    for (const id of ["a", "b"])
      await adapter.handle({
        version: 1,
        kind: "native-pi",
        action: "run",
        id,
        command: "conversation-send",
        argument: JSON.stringify({ text: "hello" }),
      });
    // Once each, however many messages follow: the agents, and the owner's
    // rule for reminders (draft it, or ask), in the owner's words.
    expect(once().map((call) => call.params.key)).toEqual([
      "register-agents-v1",
      "draft-reminders-v1",
    ]);
    expect(once()[0]!.params).toMatchObject({ space: "alpha" });
    expect(String(once()[1]!.params.text)).toMatch(
      /draft it or ask me to draft it, or interview me/,
    );
  });
});

describe("a reminder put off to a later day", () => {
  const crew = {
    source: "crew" as const,
    taskId: "prd",
    key: "captain-hold-ai-personal-assistant-q2-1",
    verb: "needs-decision",
    summary:
      "captain hold ai-personal-assistant-q2: waiting on answer to firstmate: Which context is correct? Deferred by the captain to 2026-11-23.",
  };
  const task = {
    source: "backlog" as const,
    taskId: "moca-brd",
    title: "MoCA: share the BRD",
    reason: "Captain action",
    until: "2026-12-01",
  };
  const open = {
    source: "backlog" as const,
    taskId: "moca-ticketing",
    title: "MoCA: ticketing",
    reason: "Captain reminder",
    until: null,
  };
  it("reads the day from Firstmate's record or from its words", () => {
    expect(heldUntil(crew)).toBe("2026-11-23");
    expect(heldUntil(task)).toBe("2026-12-01");
    expect(heldUntil(open)).toBeNull();
    expect(
      heldUntil({ ...crew, summary: "Moved from 26 Oct at captain's request" }),
    ).toBeNull();
  });
  it("stays away until that day, then comes back", () => {
    const all = [crew, task, open];
    expect(holdsDue(all, "2026-11-20T10:00:00Z")).toEqual([open]);
    expect(holdsDue(all, "2026-11-23T05:00:00Z")).toEqual([crew, open]);
    expect(holdsDue(all, "2026-12-02T05:00:00Z")).toEqual(all);
  });
});

it("shows a keyed PRD decision in attention and marks its parked crewmate blocked", () => {
  const view = {
    spaces: [],
    fleet: [
      {
        id: "prd",
        current_state: {
          state: "parked",
          detail: "Finished reading the brief",
        },
      },
    ],
    holds: [
      {
        source: "crew" as const,
        taskId: "prd",
        key: "brief-q1",
        verb: "needs-decision",
        summary:
          "corr=b24b353f165ba470 Finished reading the brief. Q1 - How should we plan R1? (A) Keep scope.",
      },
    ],
    work: null,
  };
  expect(holdAttention(view, "2026-11-21T11:42:00Z")[0]).toMatchObject({
    title: "How should we plan R1?",
    detail: "Product Manager (PRD)",
    state: "open",
  });
  expect(
    fleetAgents(view).find((agent) => agent.id === "crew:prd")?.state,
  ).toBe("waiting");
});
