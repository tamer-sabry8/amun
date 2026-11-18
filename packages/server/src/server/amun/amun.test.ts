import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { fleetSnapshotSchema, type FleetSnapshot } from "@getpaseo/protocol/amun-rpc";
import { resolveAmunPaths, type AmunPaths } from "./amun-paths.js";
import { AmunRpcHandler } from "./amun-rpc-handler.js";
import { attachAmun } from "./attach-amun.js";
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
import { detectRuntimeBackend, ProductSpaceStore, slugify } from "./product-spaces.js";

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
let paths: AmunPaths;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "amun-test-"));
  paths = resolveAmunPaths({ ...process.env, AMUN_HOME: tmp });
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("Product Spaces", () => {
  it("creates a Firstmate home as a real git worktree with the defaults", async () => {
    const store = new ProductSpaceStore(paths, () => new Date("2026-11-18T00:00:00Z"));
    const space = await store.create({ name: "Payments Platform", backend: "tmux" });

    expect(space.slug).toBe("payments-platform");
    expect(space.fmHome).toBe(path.join(tmp, "homes", "payments-platform"));
    for (const dir of ["state", "data", "config", "projects"]) {
      expect(existsSync(path.join(space.fmHome, dir))).toBe(true);
    }
    expect(readFileSync(path.join(space.fmHome, "config", "calm"), "utf8")).toBe("on\n");
    expect(readFileSync(path.join(space.fmHome, "config", "backend"), "utf8")).toBe("tmux\n");
    expect(readFileSync(path.join(space.fmHome, "config", "supervision-branch-effort"), "utf8")).toBe(
      "low\n",
    );
    expect(readFileSync(path.join(space.fmHome, ".tasks.toml"), "utf8")).toContain(
      'path = "data/backlog.md"',
    );
    const gitDir = execFileSync("git", ["-C", space.fmHome, "rev-parse", "--git-common-dir"], {
      encoding: "utf8",
    }).trim();
    expect(path.resolve(space.fmHome, gitDir)).toBe(paths.homesRepo);
    expect(await store.list()).toEqual([space]);
    await expect(store.create({ name: "Payments Platform" })).rejects.toThrow("already exists");
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

  it("reads a live snapshot from the vendored fm-fleet-snapshot.sh", async () => {
    const space = await new ProductSpaceStore(paths).create({ name: "Live", backend: "tmux" });
    const snapshot = await readFleetSnapshot({ root: paths.firstmateRoot, fmHome: space.fmHome });
    expect(snapshot.schema).toBe("fm-fleet-snapshot.v1");
    expect(snapshot.fm_home).toBe(space.fmHome);
    expect(snapshot.backlog.present).toBe(true);
    expect(snapshot.tasks).toEqual([]);
  }, 60_000);
});

describe("Primary session", () => {
  it("launches inside vendor/firstmate with FM_HOME, FM_ROOT_OVERRIDE and bin on PATH", async () => {
    const space = await new ProductSpaceStore(paths).create({ name: "Alpha", backend: "tmux" });
    const launch = buildPrimaryLaunch({
      space,
      firstmateRoot: paths.firstmateRoot,
      baseEnv: { PATH: "/usr/bin" },
    });
    expect(launch).toMatchObject({ provider: "pi", cwd: paths.firstmateRoot, title: "First Mate · Alpha" });
    expect(launch.env).toMatchObject({
      FM_HOME: space.fmHome,
      FM_ROOT_OVERRIDE: paths.firstmateRoot,
      PATH: `${path.join(paths.firstmateRoot, "bin")}:/usr/bin`,
      AMUN_SPACE: "alpha",
    });
    expect(() => buildPrimaryLaunch({ space, firstmateRoot: "/x", harness: "agy" })).toThrow(
      UnsupportedHarnessError,
    );
  });

  it("starts one First Mate per space and reuses it", async () => {
    const space = await new ProductSpaceStore(paths).create({ name: "Beta", backend: "tmux" });
    const host = new RecordingHost();
    const sessions = new PrimarySessions(host, paths.firstmateRoot);
    await sessions.start(space);
    await sessions.send(space, "Status?");
    expect(host.launches).toHaveLength(1);
    expect(host.prompts).toEqual(["Status?"]);
  });
});

describe("Amun RPC", () => {
  it("answers spaces, backlog and holds; refuses bad requests", async () => {
    const host = new RecordingHost();
    const spaces = new ProductSpaceStore(paths);
    const handler = new AmunRpcHandler({
      spaces,
      primary: new PrimarySessions(host, paths.firstmateRoot),
      firstmateRoot: paths.firstmateRoot,
      readSnapshot: async () => snapshotFixture(),
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

    expect(await handler.handleRaw({ id: "4", method: "nope" })).toMatchObject({
      ok: false,
      error: { code: "InvalidRequest" },
    });
    expect(await handler.handleRaw({ id: "5", method: "holds.list", space: "missing" })).toMatchObject({
      ok: false,
      error: { code: "ProductSpaceNotFoundError" },
    });
  });

  describe("over WebSocket", () => {
    let server: Server;
    afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

    it("serves /amun on the daemon HTTP server", async () => {
      server = createServer();
      const logs: string[] = [];
      const logger = { info: (_o: object, m?: string) => logs.push(m ?? ""), warn: () => {} };
      const host = new RecordingHost();
      const attachment = attachAmun({
        httpServer: server,
        agentManager: {
          createAgent: async (config: { title: string }) => ({ id: `fm-${config.title}` }),
          runAgent: async (_id: string, text: string) => host.runAgent(_id, text),
        } as never,
        logger,
        env: { ...process.env, AMUN_HOME: tmp },
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/amun`);
      await new Promise((resolve, reject) => ws.once("open", resolve).once("error", reject));
      const reply = new Promise<unknown>((resolve) => ws.once("message", (d) => resolve(JSON.parse(String(d)))));
      ws.send(JSON.stringify({ id: "a", method: "spaces.list" }));
      expect(await reply).toEqual({ id: "a", ok: true, result: [] });
      ws.close();
      attachment?.close();
      expect(logs).toContain("Amun RPC mounted");
    });
  });
});
