import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { fleetSnapshotSchema, type FleetSnapshot } from "@getpaseo/protocol/amun-rpc";
import { resolveAmunPaths, type AmunPaths } from "./amun-paths.js";
import { AmunRpcHandler, HISTORY_REQUEST, serializeRecentSteps } from "./amun-rpc-handler.js";
import { openAdo, openWorkStore } from "@amun/work-store";
import { attachAmun } from "./attach-amun.js";
import { TraceLog } from "./trace/trace-log.js";
import { unzipSync, strFromU8 } from "fflate";
import { ConnectionStore } from "./connections/connection-store.js";
import { memorySecretStore } from "./connections/secret-store.js";
import {
  boardColumnFor,
  holdAnswerPrompt,
  holdsFromSnapshot,
  readFleetSnapshot,
} from "./firstmate-cli.js";
import {
  buildPrimaryLaunch,
  PrimarySessions,
  UnsupportedHarnessError,
  type PrimaryHost,
  type PrimaryLaunch,
} from "./primary-session.js";
import { detectRuntimeBackend, homeRuntimeBackend, ProductSpaceStore, slugify } from "./product-spaces.js";

const fixture = (name: string) => path.join(import.meta.dirname, "fixtures", name);
const snapshotFixture = (): FleetSnapshot =>
  fleetSnapshotSchema.parse(JSON.parse(readFileSync(fixture("fleet-snapshot.json"), "utf8")));

class RecordingHost implements PrimaryHost {
  launches: PrimaryLaunch[] = [];
  prompts: string[] = [];
  async createAgent(launch: PrimaryLaunch) {
    this.launches.push(launch);
    return { agentId: `agent-${this.launches.length}` };
  }
  async runAgent(_agentId: string, text: string) {
    this.prompts.push(text);
    return { finalText: "Aye, Captain." };
  }
}

let tmp: string;
let fmHome: string;
let paths: AmunPaths;
const testEnv = () => ({ ...process.env, AMUN_HOME: tmp, AMUN_FIRSTMATE_HOME: fmHome });
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "amun-test-"));
  // Stands in for the captain's existing home (not a Firstmate checkout).
  fmHome = path.join(tmp, "captain-home");
  mkdirSync(path.join(fmHome, "data"), { recursive: true });
  writeFileSync(path.join(fmHome, "data", "backlog.md"), "# Backlog\n\n## In flight\n\n## Queued\n\n## Done\n");
  paths = resolveAmunPaths(testEnv());
});

/** Every file under the captain's home, so tests can prove Amun wrote nothing there. */
function homeFiles(): string[] {
  return execFileSync("find", [fmHome, "-type", "f"], { encoding: "utf8" }).trim().split("\n").sort();
}
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("Product Spaces", () => {
  it("stores products in Amun's folder and points them all at the one home", async () => {
    const before = homeFiles();
    let tick = 0;
    const store = new ProductSpaceStore(paths, () => new Date(Date.UTC(2026, 10, 18, 0, 0, tick++)));
    const space = await store.create({ name: "Payments Platform" });
    const other = await store.create({ name: "ICV" });

    expect(space.slug).toBe("payments-platform");
    expect(space.fmHome).toBe(fmHome);
    expect(other.fmHome).toBe(fmHome);
    expect(existsSync(path.join(tmp, "products", "payments-platform.json"))).toBe(true);
    expect(homeFiles()).toEqual(before);
    expect((await store.list()).map((s) => s.slug)).toEqual(["payments-platform", "icv"]);
    await expect(store.create({ name: "Payments Platform" })).rejects.toThrow("already exists");
  });

  it("reads the home's own config/backend and never writes it", () => {
    mkdirSync(path.join(fmHome, "config"));
    writeFileSync(path.join(fmHome, "config", "backend"), "hc\n");
    expect(homeRuntimeBackend(fmHome, "")).toBe("hc");
  });

  it("uses the home as the code root when the home is a Firstmate checkout", () => {
    mkdirSync(path.join(fmHome, "bin"));
    writeFileSync(path.join(fmHome, "AGENTS.md"), "# Firstmate\n");
    writeFileSync(path.join(fmHome, "bin", "fm-send.sh"), "#!/bin/sh\n");
    expect(resolveAmunPaths(testEnv()).firstmateRoot).toBe(fmHome);
  });

  it("picks hc only when herdr-core or hc is on PATH", () => {
    const bin = path.join(tmp, "bin");
    execFileSync("mkdir", ["-p", bin]);
    expect(detectRuntimeBackend(bin)).toBe("tmux");
    writeFileSync(path.join(bin, "herdr-core"), "#!/bin/sh\n", { mode: 0o755 });
    expect(detectRuntimeBackend(bin)).toBe("hc");
  });

  it("slugifies names", () => {
    expect(slugify("  Café Ops / 2027 ")).toBe("cafe-ops-2027");
    expect(slugify("!!!")).toBe("space");
  });
});

describe("Firstmate snapshot mapping", () => {
  it("derives captain holds from backlog holds and crew open decisions", () => {
    expect(holdsFromSnapshot(snapshotFixture())).toEqual([
      {
        source: "backlog",
        taskId: "billing-p1",
        title: "PRD for billing",
        reason: "Pick pricing tier",
        until: null,
      },
      {
        source: "crew",
        taskId: "proto-w1",
        key: "default",
        verb: "needs-decision",
        summary: "one-page or two-step checkout?",
      },
    ]);
  });

  it("maps tasks-axi rows onto the six board columns", () => {
    const columns = Object.fromEntries(
      snapshotFixture().backlog.records.map((record) => [record.id, boardColumnFor(record)]),
    );
    expect(columns).toEqual({ "proto-w1": "in_progress", "onboard-d1": "discovery", "billing-p1": "spec" });
    expect(boardColumnFor({ state: "in_flight", pr_url: "https://x/pull/1" })).toBe("review");
    expect(boardColumnFor({ state: "done" })).toBe("done");
    expect(boardColumnFor({ state: "queued", kind: "ship" })).toBe("backlog");
  });

  it("routes a crew answer through the First Mate with the resolve key", () => {
    const prompt = holdAnswerPrompt(
      { source: "crew", taskId: "proto-w1", key: "layout", verb: "needs-decision", summary: "?" },
      "One page",
    );
    expect(prompt).toContain("bin/fm-send.sh proto-w1 --resolve-key layout");
    expect(prompt).toContain("Answer: One page");
  });

  it("puts a reminder off without asking Firstmate to answer and close it", () => {
    const backlog = holdAnswerPrompt(
      { source: "backlog", taskId: "moca-ticketing", title: "Ticketing", reason: "Which system?", until: null },
      "Not now",
      "2026-11-23",
    );
    expect(backlog).toContain("hold moca-ticketing --reason <its current reason> --until 2026-11-23");
    expect(backlog).toContain("Do not run bin/fm-captain-hold.sh answer");
    expect(backlog).not.toContain("Record it with bin/fm-captain-hold.sh answer");
    const crew = holdAnswerPrompt(
      { source: "crew", taskId: "proto-w1", key: "layout", verb: "needs-decision", summary: "?" },
      "Not now",
      "2026-11-23",
    );
    expect(crew).not.toContain("--resolve-key");
    expect(crew).toContain("--until 2026-11-23");
  });

  it("reads a live snapshot from the vendored fm-fleet-snapshot.sh", async () => {
    const space = await new ProductSpaceStore(paths).create({ name: "Live" });
    const snapshot = await readFleetSnapshot({ root: paths.firstmateRoot, fmHome: space.fmHome });
    expect(snapshot.schema).toBe("fm-fleet-snapshot.v1");
    expect(snapshot.fm_home).toBe(space.fmHome);
    expect(snapshot.backlog.present).toBe(true);
    expect(snapshot.tasks).toEqual([]);
  }, 60_000);
});

describe("Primary session", () => {
  it("launches headless at the code root with FM_HOME, FM_ROOT_OVERRIDE and bin on PATH", async () => {
    const space = await new ProductSpaceStore(paths).create({ name: "Alpha" });
    const launch = buildPrimaryLaunch({
      space,
      firstmateRoot: paths.firstmateRoot,
      baseEnv: { PATH: "/usr/bin" },
    });
    expect(launch).toMatchObject({ provider: "pi", cwd: paths.firstmateRoot, title: "First Mate" });
    expect(launch.env).toMatchObject({
      FM_HOME: space.fmHome,
      FM_ROOT_OVERRIDE: paths.firstmateRoot,
      FM_SESSION_START_TIMEOUT: "300",
      FM_ARM_CONFIRM_TIMEOUT: "30",
      PATH: `${path.join(paths.firstmateRoot, "bin")}:/usr/bin`,
    });
    const custom = buildPrimaryLaunch({
      space,
      firstmateRoot: paths.firstmateRoot,
      baseEnv: {
        PATH: "/usr/bin",
        FM_SESSION_START_TIMEOUT: "420",
        FM_ARM_CONFIRM_TIMEOUT: "45",
      },
    });
    expect(custom.env).toMatchObject({
      FM_SESSION_START_TIMEOUT: "420",
      FM_ARM_CONFIRM_TIMEOUT: "45",
    });
    expect(() => buildPrimaryLaunch({ space, firstmateRoot: "/x", harness: "agy" })).toThrow(
      UnsupportedHarnessError,
    );
  });

  it("starts one First Mate for the home, shared by every product", async () => {
    const store = new ProductSpaceStore(paths);
    const space = await store.create({ name: "Beta" });
    const other = await store.create({ name: "Delta" });
    const host = new RecordingHost();
    const sessions = new PrimarySessions(host, paths.firstmateRoot);
    await Promise.all([sessions.start(space), sessions.start(other)]);
    await sessions.send(space, "Status?");
    expect(host.launches).toHaveLength(1);
    expect(host.prompts).toEqual(["Status?"]);
  });
});

describe("Amun RPC", () => {
  it("answers spaces, backlog and holds; refuses bad requests", async () => {
    const host = new RecordingHost();
    const spaces = new ProductSpaceStore(paths);
    const opened = openWorkStore(":memory:");
    const seen: string[] = [];
    const trace = new TraceLog({ dir: path.join(paths.amunHome, "trace"), redactor: opened.redactor });
    const handler = new AmunRpcHandler({
      spaces,
      primary: new PrimarySessions(host, paths.firstmateRoot),
      connections: new ConnectionStore(paths.amunHome, memorySecretStore()),
      work: opened.store,
      workspace: opened.workspace,
      ado: openAdo(opened, {
        connections: async () => [{ kind: "ado", baseUrl: "https://devops.example.com/Coll/" }],
        secret: async () => "pat-for-tests-0123456789",
        fetch: async (url) => {
          seen.push(String(url));
          return new Response(JSON.stringify({ value: [{ id: "t1", name: "Payments Team" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      }),
      amunHome: paths.amunHome,
      firstmateRoot: paths.firstmateRoot,
      readSnapshot: async () => snapshotFixture(),
      trace,
      redactor: opened.redactor,
      fmHome: paths.fmHome,
      readTimeline: async () => [
        { seq: 1, timestamp: "2026-11-19T10:41:00.000Z", item: { type: "user_message", text: "Start pricing." } },
        {
          seq: 2,
          timestamp: "2026-11-19T10:41:02.000Z",
          item: {
            type: "tool_call",
            name: "bash",
            status: "completed",
            detail: { type: "shell", command: "bin/fm-spawn.sh pricing --token s3cr3t-token-value" },
          } as never,
        },
      ],
    });
    const created = await handler.handleRaw({ id: "1", method: "spaces.create", name: "Gamma" });
    expect(created).toMatchObject({ id: "1", ok: true, result: { slug: "gamma" } });

    const backlog = await handler.handleRaw({ id: "2", method: "backlog.list", space: "gamma" });
    expect(backlog.ok && (backlog.result as { id: string; column: string }[]).map((r) => r.column)).toEqual([
      "in_progress",
      "discovery",
      "spec",
    ]);

    const answer = await handler.handleRaw({
      id: "3",
      method: "holds.answer",
      space: "gamma",
      hold: { source: "backlog", taskId: "billing-p1", title: "PRD", reason: "Tier?", until: null },
      answer: "Pro tier",
    });
    expect(answer).toMatchObject({ ok: true, result: { reply: "Aye, Captain." } });
    expect(host.prompts[0]).toContain("bin/fm-captain-hold.sh answer");

    const group = await handler.handleRaw({
      id: "w",
      method: "work.command",
      command: { action: "add-group", name: "Work" },
    });
    expect(group.ok && (group.result as { kind: string; ok?: boolean }[])[0]).toMatchObject({
      kind: "work-result",
      ok: true,
    });
    const work = await handler.handleRaw({ id: "ws", method: "work.snapshot" });
    expect(work.ok && (work.result as { groups: { name: string }[] }).groups.map((g) => g.name)).toEqual([
      "Work",
    ]);

    const board = await handler.handleRaw({ id: "b", method: "board.get", space: "gamma" });
    expect(board.ok && (board.result as Record<string, { id: string }[]>).spec!.map((s) => s.id)).toEqual([
      "billing-p1",
    ]);
    const initiative = await handler.handleRaw({
      id: "i",
      method: "initiative.upsert",
      space: "gamma",
      initiative: { id: "billing", title: "Usage billing", what: "Metered plans" },
    });
    expect(initiative).toMatchObject({ ok: true, result: { missing: ["why", "when", "cost"] } });
    expect(existsSync(path.join(fmHome, "data", "amun-pm.db"))).toBe(false);
    expect(existsSync(path.join(tmp, "pm"))).toBe(true);

    // A product maps an Azure DevOps project, then reads its teams through the daemon.
    const created2 = await handler.handleRaw({
      id: "p",
      method: "workspace.command",
      command: { action: "create-product", name: "Payments", allowedModels: [] },
    });
    expect(created2.ok).toBe(true);
    const products = await handler.handleRaw({ id: "ps", method: "workspace.snapshot" });
    const productId = products.ok
      ? (products.result as { products: { id: string; name: string }[] }).products.find(
          (p) => p.name === "Payments",
        )!.id
      : "";
    await handler.handleRaw({
      id: "m",
      method: "workspace.command",
      command: {
        action: "map-source",
        productId,
        sourceKind: "ado",
        title: "Payments",
        reference: "https://devops.example.com/Coll/Payments",
      },
    });
    const mapped = await handler.handleRaw({ id: "ps2", method: "workspace.snapshot" });
    const source = mapped.ok
      ? (mapped.result as { productContext: { sources: { id: string; reference: string }[] } | null })
          .productContext?.sources[0]
      : undefined;
    expect(source?.reference).toBe("https://devops.example.com/Coll/Payments");
    const teams = await handler.handleRaw({
      id: "a",
      method: "ado.request",
      message: {
        version: 1,
        kind: "backlog-read",
        requestId: "11111111-1111-4111-8111-111111111111",
        productId,
        sourceId: source!.id,
        action: "teams",
      },
    });
    expect(teams).toMatchObject({
      ok: true,
      result: { view: "teams", teams: [{ id: "t1", name: "Payments Team" }] },
    });
    expect(seen[0]).toContain("https://devops.example.com/Coll/_apis/projects/Payments/teams");

    // The trace says who said what to whom, and the bundle carries it.
    const traced = trace
      .files()
      .map((file) => readFileSync(path.join(trace.dir, file), "utf8"))
      .join("")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(traced).toContainEqual(
      expect.objectContaining({ source: "chat", from: "captain", to: "first-mate", text: "Pro tier" }),
    );
    expect(traced).toContainEqual(
      expect.objectContaining({ source: "chat", from: "first-mate", text: "Aye, Captain." }),
    );
    const before = homeFiles();
    opened.redactor.register("s3cr3t-token-value");
    trace.record({ source: "test", kind: "leak", text: "token s3cr3t-token-value" });
    const exported = await handler.handleRaw({ id: "t", method: "trace.export" });
    expect(exported.ok).toBe(true);
    const bundle = exported.ok ? (exported.result as { base64: string; path: string }) : null;
    const entries = unzipSync(new Uint8Array(Buffer.from(bundle!.base64, "base64")));
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining([
        "manifest.json",
        "firstmate/config-flags.txt",
        "git/worktrees.txt",
        "first-mate/steps.json",
      ]),
    );
    const everything = Object.values(entries).map((bytes) => strFromU8(bytes)).join("\n");
    expect(everything).toContain("Pro tier");
    expect(everything).not.toContain("s3cr3t-token-value");
    const steps = JSON.parse(strFromU8(entries["first-mate/steps.json"]!)) as {
      steps: { words: string; sent: string }[];
    }[];
    expect(steps[0]!.steps[0]).toMatchObject({
      words: "started a crewmate in its own worktree",
      sent: "bin/fm-spawn.sh pricing --token [REDACTED]",
    });
    expect(bundle!.path.startsWith(paths.amunHome)).toBe(true);

    // History is requested from the First Mate once; Amun writes nothing in the home.
    const asked = await handler.handleRaw({ id: "h1", method: "trace.history", space: "gamma" });
    expect(asked).toMatchObject({ ok: true, result: { asked: true } });
    expect(host.prompts).toContain(HISTORY_REQUEST);
    const again = await handler.handleRaw({ id: "h2", method: "trace.history", space: "gamma" });
    expect(again).toMatchObject({ ok: true, result: { asked: false } });
    expect(homeFiles()).toEqual(before);

    expect(await handler.handleRaw({ id: "4", method: "nope" })).toMatchObject({
      ok: false,
      error: { code: "InvalidRequest" },
    });
    expect(await handler.handleRaw({ id: "5", method: "holds.list", space: "missing" })).toMatchObject({
      ok: false,
      error: { code: "ProductSpaceNotFoundError" },
    });
  });

  it("keeps the newest turns as valid JSON when steps.json exceeds the redactor limit", () => {
    const oldTurn = { id: "t1", prompt: "old-" + "a".repeat(400) };
    const midTurn = { id: "t2", prompt: "mid-" + "b".repeat(400) };
    const newTurn = { id: "t3", prompt: "new-" + "c".repeat(400) };
    const json = serializeRecentSteps([oldTurn, midTurn, newTurn], 1000);
    expect(json.length).toBeLessThanOrEqual(1000);
    const parsed = JSON.parse(json) as { id: string }[];
    expect(parsed.map((item) => item.id)).toEqual(["t2", "t3"]);
  });

  describe("over WebSocket", () => {
    let server: Server;
    afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

    it("serves /amun on the daemon HTTP server", async () => {
      server = createServer();
      const logs: string[] = [];
      const logger = { info: (_o: object, m?: string) => logs.push(m ?? ""), warn: () => {} };
      const host = new RecordingHost();
      let subscribed = 0;
      const attachment = attachAmun({
        httpServer: server,
        agentManager: {
          createAgent: async (config: { title: string }) => ({ id: `fm-${config.title}` }),
          runAgent: async (_id: string, text: string) => host.runAgent(_id, text),
          subscribe: () => {
            subscribed += 1;
            return () => {
              subscribed -= 1;
            };
          },
        } as never,
        logger,
        env: testEnv(),
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/amun`);
      await new Promise((resolve, reject) => ws.once("open", resolve).once("error", reject));
      const reply = new Promise<unknown>((resolve) => ws.once("message", (d) => resolve(JSON.parse(String(d)))));
      ws.send(JSON.stringify({ id: "a", method: "spaces.list" }));
      expect(await reply).toEqual({ id: "a", ok: true, result: [] });
      // The First Mate's own turns (heartbeats, wakes) are watched while mounted.
      expect(subscribed).toBe(1);
      ws.close();
      attachment?.close();
      expect(subscribed).toBe(0);
      expect(logs).toContain("Amun RPC mounted");
    });
  });
});
