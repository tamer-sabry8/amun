import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { migrate } from "../src/database.ts";
import { WorkStore } from "../src/work-store.ts";
import { ask, pending } from "../../council/src/bridge.ts";
import {
  CouncilService,
  type ChairProcess,
  type CouncilDeps,
} from "../../council/src/service.ts";
import {
  readManifest,
  writeManifest,
  type Fetcher,
} from "../../council/src/runtime.ts";

let root: string;
let store: WorkStore;
let spawned: { command: string; args: string[]; cwd: string; stdin: string }[];
let finish: (code: number) => void;
let claude: string | null;

const write = async (dir: string, file: string, text: string) => {
  await mkdir(dirname(join(dir, file)), { recursive: true });
  await writeFile(join(dir, file), text);
};
async function upstream(dir: string, keys = ["alpha", "beta"]) {
  await write(
    dir,
    ".claude/skills/roast-room/roster.json",
    JSON.stringify({
      seats: keys.map((key) => ({
        key,
        name: "Advisor " + key,
        slug: "brain-" + key,
      })),
    }),
  );
  for (const key of keys) {
    await write(dir, `.claude/agents/council-${key}.md`, "agent");
    await write(
      dir,
      `.claude/skills/roast-room/brains/brain-${key}/brain.md`,
      "brain",
    );
  }
  await write(
    dir,
    ".claude/skills/roast-room/SKILL.md",
    "---\nname: roast-room\n---\n--quick --seats --all ask board\n",
  );
  await write(dir, "app/server.mjs", "export {};\n");
}
const fetcher = (): Fetcher => ({
  head: async () => "bbbbbbb",
  download: async (_commit, destination) =>
    upstream(destination, ["alpha", "beta", "gamma"]),
});
function service(extra: Partial<CouncilDeps> = {}) {
  return new CouncilService({
    root,
    records: store,
    findClaude: async () => claude,
    spawn: (input) => {
      spawned.push(input);
      const process: ChairProcess = {
        done: new Promise((resolve) => {
          finish = resolve;
        }),
        stop: () => finish(143),
      };
      return process;
    },
    askServer: {
      command: "/usr/bin/node",
      args: ["/app/ask.cjs"],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    },
    fetcher,
    bundledNode: "24.22.1",
    now: () => new Date("2026-11-12T00:00:00Z"),
    ...extra,
  });
}
async function installed() {
  await upstream(join(root, "vendor", "aaaaaaa"));
  await writeManifest(root, {
    repo: "owner/roast-room",
    current: { commit: "aaaaaaa", sha256: "x", validatedAt: "t" },
    previous: null,
    lastCheckedAt: "2026-11-11T00:00:00Z",
  });
  const council = service();
  await council.toggleSeat("none", false);
  return council;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(async () => {
  root = join(await mkdtemp(join(tmpdir(), "amun-council-svc-")), "roast-room");
  await mkdir(root, { recursive: true });
  const db = new Database(":memory:");
  migrate(db);
  store = new WorkStore(db);
  spawned = [];
  claude = "/usr/local/bin/claude";
});
afterEach(async () => {
  await rm(dirname(root), { recursive: true, force: true });
});

describe("Council service", () => {
  it("reports that advisors are not installed and refuses to start", async () => {
    const council = service();
    expect(await council.status()).toMatchObject({
      installed: false,
      commit: null,
      claude: true,
      seats: [],
    });
    expect(
      await council.run({
        text: "/roast-room Raise prices",
        workAreaId: null,
        groupId: null,
      }),
    ).toEqual({
      ok: false,
      reason: "The Council’s advisors are not installed yet.",
    });
    expect(await council.checkUpdate(true)).toMatchObject({
      message: "No source is set for the Council’s advisors yet.",
    });
    expect(spawned).toEqual([]);
  });
  it("needs Claude Code on this Mac and a real Council command", async () => {
    const council = await installed();
    claude = null;
    expect((await council.status()).claude).toBe(false);
    expect(
      await council.run({
        text: "/roast-room Raise prices",
        workAreaId: null,
        groupId: null,
      }),
    ).toMatchObject({
      ok: false,
      reason: expect.stringContaining("Claude Code"),
    });
    expect(
      await council.run({
        text: "/roast-room",
        workAreaId: null,
        groupId: null,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await council.run({ text: "hello", workAreaId: null, groupId: null }),
    ).toEqual({
      ok: false,
      reason: "That is not a Council command.",
    });
  });
  it("runs the Chair headless in the composed runtime with Amun's question tool", async () => {
    const council = await installed();
    const started = await council.run({
      text: "/roast-room Raise prices",
      workAreaId: null,
      groupId: null,
      context: "BRD v2",
    });
    expect(started.ok).toBe(true);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.command).toBe("/usr/local/bin/claude");
    expect(spawned[0]!.cwd).toBe(join(root, "runtime", "current"));
    expect(JSON.parse(spawned[0]!.stdin).message.content).toBe(
      "/roast-room Raise prices --quick\n\nContext you may use:\nBRD v2",
    );
    expect(JSON.parse(await readFile(join(root, "mcp.json"), "utf8"))).toEqual({
      mcpServers: {
        amun_council: {
          command: "/usr/bin/node",
          args: ["/app/ask.cjs", join(root, "bridge")],
          env: { ELECTRON_RUN_AS_NODE: "1" },
        },
      },
    });
    expect(store.snapshot().council).toMatchObject([
      { decision: "Raise prices", mode: "quick", state: "running" },
    ]);
    expect(store.snapshot().activity).toMatchObject([
      { state: "running", text: "Council in session: Raise prices" },
    ]);
    expect(
      await council.run({
        text: "/roast-room Other",
        workAreaId: null,
        groupId: null,
      }),
    ).toEqual({
      ok: false,
      reason: "A council is already in session.",
    });
  });
  it("bridges a Chair question to the Island and the answer back", async () => {
    const council = await installed();
    await council.run({
      text: "/roast-room Raise prices",
      workAreaId: null,
      groupId: null,
    });
    await ask(join(root, "bridge"), "q1", {
      questions: [
        { question: "What is the budget?", options: ["Under 1M", "Over 1M"] },
      ],
    });
    await council.poll();
    await council.poll();
    const question = store.snapshot().attention;
    expect(question).toMatchObject([
      {
        kind: "question",
        title: "What is the budget?",
        options: ["Under 1M", "Over 1M"],
        state: "open",
      },
    ]);
    expect(store.snapshot().council[0]!.state).toBe("waiting_on_you");
    // Nothing is assumed while it waits.
    expect(await pending(join(root, "bridge"))).toHaveLength(1);
    store.handle({
      version: 1,
      kind: "work",
      action: "resolve-attention",
      attentionId: question[0]!.id,
      resolution: "answer",
      answer: "Under 1M",
    });
    await council.poll();
    expect(
      JSON.parse(
        await readFile(join(root, "bridge", "answer-q1.json"), "utf8"),
      ),
    ).toEqual({
      id: "q1",
      answers: ["Under 1M"],
    });
    expect(store.snapshot().council[0]!.state).toBe("running");
  });
  it("files the verdict: report to the Library, recommendation to Decisions", async () => {
    const council = await installed();
    await council.run({
      text: "/roast-room Raise prices",
      workAreaId: null,
      groupId: null,
    });
    await write(
      join(root, "sessions", "2026-11-12-raise-prices"),
      "verdict.md",
      "# Verdict\n\nScores…\n\n## Recommendation\n\nRaise by 10% for new customers.\n\n## Dissent\n\nOne seat disagreed.\n",
    );
    finish(0);
    await settle();
    const snapshot = store.snapshot();
    expect(snapshot.council[0]).toMatchObject({
      state: "finished",
      recommendation: "Raise by 10% for new customers.",
    });
    expect(snapshot.library).toMatchObject([
      { type: "council_report", title: "Council · Raise prices" },
    ]);
    expect(snapshot.decisions).toMatchObject([
      { source: "council", outcome: null },
    ]);
    expect(snapshot.attention).toMatchObject([
      { kind: "result", title: "Council verdict ready: Raise prices" },
    ]);
    expect(snapshot.roadmap).toEqual([]);
    expect(snapshot.plans).toEqual([]);
  });
  it("records a council that did not finish as a failure", async () => {
    const council = await installed();
    await council.run({
      text: "/roast-room ask alpha Is this wise?",
      workAreaId: null,
      groupId: null,
    });
    finish(1);
    await settle();
    expect(store.snapshot().council[0]).toMatchObject({
      state: "failed",
      mode: "ask",
      recommendation: null,
    });
    expect(store.snapshot().attention).toMatchObject([{ kind: "failure" }]);
    expect(store.snapshot().library).toEqual([]);
  });
  it("applies a validated weekly update, notes it in Activity, and can roll back", async () => {
    const council = await installed();
    // Checked yesterday: nothing happens unless asked.
    await council.checkUpdate();
    expect((await council.status()).commit).toBe("aaaaaaa");
    const updated = await council.checkUpdate(true);
    expect(updated).toMatchObject({
      commit: "bbbbbbb",
      previous: "aaaaaaa",
      message: "Updated to bbbbbbb.",
    });
    expect(updated.seats.map((seat) => seat.key)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(store.snapshot().activity[0]!.text).toMatch(/^Council updated to/);
    // An update never raises an attention item by itself.
    expect(store.snapshot().attention).toEqual([]);
    expect(await council.rollback()).toMatchObject({
      commit: "aaaaaaa",
      message: "Went back to aaaaaaa.",
    });
  });
  it("keeps the current version when an update is rejected or the check fails", async () => {
    const council = service({
      fetcher: () => ({
        head: async () => "ccccccc",
        download: async (_commit, destination) =>
          write(destination, ".claude/skills/roast-room/roster.json", "{}"),
      }),
    });
    await upstream(join(root, "vendor", "aaaaaaa"));
    await writeManifest(root, {
      repo: "o/r",
      current: { commit: "aaaaaaa", sha256: "x", validatedAt: "t" },
      previous: null,
      lastCheckedAt: null,
    });
    expect(await council.checkUpdate()).toMatchObject({
      commit: "aaaaaaa",
      message:
        "An update was not applied: The roster file is missing or unreadable.",
    });
    expect(store.snapshot().activity[0]).toMatchObject({ state: "failed" });
    const offline = service({
      fetcher: () => ({
        head: async () => {
          throw Error("offline");
        },
        download: async () => undefined,
      }),
    });
    expect((await offline.checkUpdate(true)).message).toBe(
      "The Council could not check for updates: offline",
    );
  });
  it("switching a seat off recomposes the runtime", async () => {
    const council = await installed();
    const status = await council.toggleSeat("beta", true);
    expect(status.seats).toEqual([
      { key: "alpha", name: "Advisor alpha", disabled: false },
      { key: "beta", name: "Advisor beta", disabled: true },
    ]);
    const roster = JSON.parse(
      await readFile(
        join(
          root,
          "runtime",
          "current",
          ".claude/skills/roast-room/roster.json",
        ),
        "utf8",
      ),
    );
    expect(roster.seats.map((seat: { key: string }) => seat.key)).toEqual([
      "alpha",
    ]);
  });
  it("installs the version shipped with Amun on first use, and keeps a newer one", async () => {
    const staged = join(dirname(root), "staged");
    await upstream(staged);
    const pin = {
      repository: "https://github.com/nateherkai/roast-room",
      commit: "e".repeat(40),
      sha256: "f".repeat(64),
    };
    const council = service({ shipped: { directory: staged, pin } });
    expect(await council.status()).toMatchObject({
      installed: true,
      commit: pin.commit,
      repo: "nateherkai/roast-room",
      seats: [
        { key: "alpha", disabled: false },
        { key: "beta", disabled: false },
      ],
    });
    // A second start with a different shipped pin never downgrades the user.
    const later = service({
      shipped: { directory: staged, pin: { ...pin, commit: "d".repeat(40) } },
    });
    expect((await later.status()).commit).toBe(pin.commit);
    expect((await readManifest(root)).previous).toBeNull();
  });
  it("says so when this build has no advisors, and opens the room when it can", async () => {
    const missing = service({
      shipped: {
        directory: join(dirname(root), "nowhere"),
        pin: {
          repository: "x",
          commit: "e".repeat(40),
          sha256: "f".repeat(64),
        },
      },
    });
    expect(await missing.status()).toMatchObject({
      installed: false,
      message: "The Council’s advisors were not included in this build.",
    });
    expect((await missing.openRoom()).message).toBe(
      "The room is not available yet.",
    );
    let started = "";
    let stopped = 0;
    const council = service({
      room: {
        start: async (directory) => {
          started = directory;
          return "http://127.0.0.1:5123/";
        },
        stop: () => {
          stopped++;
        },
      },
    });
    await upstream(join(root, "vendor", "aaaaaaa"));
    await writeManifest(root, {
      repo: "o/r",
      current: { commit: "aaaaaaa", sha256: "x", validatedAt: "t" },
      previous: null,
      lastCheckedAt: null,
    });
    expect((await council.openRoom()).roomUrl).toBe("http://127.0.0.1:5123/");
    expect(started).toBe(join(root, "runtime", "current"));
    expect((await council.closeRoom()).roomUrl).toBeNull();
    expect(stopped).toBe(1);
    const failing = service({
      room: {
        start: async () => {
          throw Error("The room did not start in time.");
        },
        stop: () => undefined,
      },
    });
    expect(await failing.openRoom()).toMatchObject({
      roomUrl: null,
      message: "The room did not start in time.",
    });
  });
});
