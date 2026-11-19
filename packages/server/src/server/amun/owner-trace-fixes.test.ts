import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { ensureBackendServer, type BackendServerDeps } from "./firstmate-cli.js";
import { serveNotionForFirstMate } from "./notion-for-first-mate.js";
import { isAllClear, repliesInRun } from "./unprompted-turns.js";

function home(backend: string | null) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "amun-fm-"));
  if (backend !== null) {
    mkdirSync(path.join(dir, "config"));
    writeFileSync(path.join(dir, "config", "backend"), backend + "\n");
  }
  return { root: dir, fmHome: dir };
}

function herdr(states: boolean[], markers: string[] = []) {
  const started: { session: string; env: Record<string, string> }[] = [];
  const deps: BackendServerDeps = {
    async status() {
      const running = states.length > 1 ? states.shift()! : states[0]!;
      return JSON.stringify({ server: { running, socket: "/run/herdr/default/herdr.sock" } });
    },
    exists: (file) => markers.includes(path.basename(file)),
    start(session, env) {
      started.push({ session, env });
    },
    wait: async () => undefined,
  };
  return { deps, started };
}

describe("herdr server before the fleet is read", () => {
  it("starts the server on its own when a herdr home has none running", async () => {
    const { deps, started } = herdr([false, false, true]);
    expect(await ensureBackendServer(home("herdr"), deps)).toBe("started");
    expect(started).toHaveLength(1);
    expect(started[0]!.session).toBe("default");
    // Like Firstmate, the server is not given this home's or Pi's identity.
    expect(started[0]!.env.FM_HOME).toBeUndefined();
    expect(started[0]!.env.PI_CODING_AGENT).toBeUndefined();
  });

  it("never starts a server another manager owns or is replacing", async () => {
    for (const marker of ["firstmate-server-owner", "firstmate-server-replacing"]) {
      const owned = herdr([false], [marker]);
      expect(await ensureBackendServer(home("herdr"), owned.deps)).toBe("managed");
      expect(owned.started).toEqual([]);
    }
  });

  it("leaves a running server, a tmux home and a home with no backend alone", async () => {
    const running = herdr([true]);
    expect(await ensureBackendServer(home("herdr"), running.deps)).toBe("running");
    expect(running.started).toEqual([]);
    const tmux = herdr([false]);
    expect(await ensureBackendServer(home("tmux"), tmux.deps)).toBe("not-herdr");
    expect(await ensureBackendServer(home(null), tmux.deps)).toBe("not-herdr");
    expect(tmux.started).toEqual([]);
  });
});

describe("replies in one First Mate run", () => {
  it("keeps the owner's own reply first and wake replies after it", () => {
    expect(
      repliesInRun([
        { type: "user_message", text: "yes" },
        { type: "tool_call" },
        { type: "assistant_message", text: "Aye, " },
        { type: "assistant_message", text: "the lock is cleared." },
        { type: "user_message", text: "FIRSTMATE WATCHER WAKE" },
        { type: "assistant_message", text: "Captain, shipshape." },
      ]),
    ).toEqual(["Aye, the lock is cleared.", "Captain, shipshape."]);
  });

  it("treats only a bare all-clear as nothing to show", () => {
    expect(isAllClear("Captain, shipshape.")).toBe(true);
    expect(isAllClear("Aye. All quiet")).toBe(true);
    expect(isAllClear("Captain, shipshape, but Designer is blocked on the logo.")).toBe(false);
  });
});

const get = (socket: string, url: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ socketPath: socket, path: url }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });

describe("Notion for the First Mate", () => {
  it("answers searches and page reads through Amun's connection, read only", async () => {
    const amunHome = mkdtempSync(path.join(os.tmpdir(), "amun-home-"));
    const asked: unknown[] = [];
    const served = serveNotionForFirstMate({
      amunHome,
      notion: {
        async lookup(request) {
          asked.push(request);
          if (request.kind === "read" && request.page === "gone") throw Error("Reconnect Notion");
          return request.kind === "search" ? "About me: Tamer, product lead" : "Page text";
        },
      },
    });
    const socket = path.join(amunHome, "run", "notion.sock");
    await new Promise((done) => setTimeout(done, 50));
    try {
      expect(await get(socket, "/notion/search?q=about%20me")).toEqual({
        status: 200,
        body: "About me: Tamer, product lead",
      });
      expect((await get(socket, "/notion/read?q=gone")).body).toMatch(/connect it in Settings, Tools/);
      expect((await get(socket, "/notion/write?q=x")).status).toBe(400);
      expect(asked).toEqual([
        { kind: "search", query: "about me" },
        { kind: "read", page: "gone" },
      ]);
      // The script the First Mate runs gives the same answer.
      const { stdout } = await promisify(execFile)(served.script, ["search", "about", "me"]);
      expect(stdout).toBe("About me: Tamer, product lead");
    } finally {
      served.close();
    }
  });
});
