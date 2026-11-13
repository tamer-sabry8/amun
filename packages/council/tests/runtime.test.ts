import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  checksum,
  compose,
  files,
  readManifest,
  readRegistry,
  rollback,
  seats,
  setSeatDisabled,
  update,
  validate,
  writeManifest,
  type Fetcher,
} from "../src/runtime.ts";
import { answer, ask, pending, waitForAnswer } from "../src/bridge.ts";
import { handle, toolName } from "../src/ask-server.ts";
import { themeMap } from "../../domain/src/work/council.ts";

let root: string;
let outside: string;
beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), "amun-council-"));
  root = join(base, "roast-room");
  outside = join(base, "outside");
  await mkdir(root, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "untouched.txt"), "keep");
});
afterEach(async () => {
  await rm(dirname(root), { recursive: true, force: true });
});

const write = async (dir: string, file: string, text: string) => {
  await mkdir(dirname(join(dir, file)), { recursive: true });
  await writeFile(join(dir, file), text);
};
const skill =
  "---\nname: roast-room\nargument-hint: <decision> [--quick | --seats a,b | --all] | ask <seat> | board\n---\nProtocol.\n";
/** A stand-in for the upstream repository at one commit. */
async function upstream(
  dir: string,
  options: {
    seats?: string[];
    extra?: Record<string, string>;
    skill?: string;
    roster?: string;
  } = {},
) {
  const keys = options.seats ?? ["alpha", "beta"];
  await write(
    dir,
    ".claude/skills/roast-room/roster.json",
    options.roster ??
      JSON.stringify({
        seats: keys.map((key) => ({
          key,
          name: "Advisor " + key,
          slug: "brain-" + key,
        })),
        board: "ask",
        default: keys.slice(0, 2),
      }),
  );
  for (const key of keys) {
    await write(dir, `.claude/agents/council-${key}.md`, "agent " + key);
    await write(
      dir,
      `.claude/skills/roast-room/brains/brain-${key}/brain.md`,
      "brain " + key,
    );
  }
  await write(
    dir,
    ".claude/skills/roast-room/SKILL.md",
    options.skill ?? skill,
  );
  await write(dir, "app/server.mjs", "export {};\n");
  await write(dir, "app/public/styles.css", ":root{}\n");
  for (const [file, text] of Object.entries(options.extra ?? {}))
    await write(dir, file, text);
}
const install = async (
  commit: string,
  options?: Parameters<typeof upstream>[1],
) => {
  await upstream(join(root, "vendor", commit), options);
};
const fetcher = (
  commit: string,
  options?: Parameters<typeof upstream>[1],
  requiredNode: string | null = null,
): Fetcher => ({
  head: async () => commit,
  download: async (_commit, destination) => upstream(destination, options),
  requiredNode: async () => requiredNode,
});
const tokensCss =
  `[data-theme="dark"] {\n` +
  themeMap.map(([, amun]) => `  ${amun}: #111111;`).join("\n") +
  "\n}\n";

describe("composition (plan §3)", () => {
  it("builds the runtime from upstream plus the registry and activates it", async () => {
    await install("aaaaaaa");
    await write(
      root,
      "registry/advisors/risk/advisor.json",
      JSON.stringify({
        key: "risk",
        name: "Risk guardian",
        slug: "brain-risk",
      }),
    );
    await write(root, "registry/advisors/risk/agent.md", "risk agent");
    await write(root, "registry/advisors/risk/brain/brain.md", "risk brain");
    await write(root, "registry/advisors/risk/portraits/risk.png", "png");
    await setSeatDisabled(root, "beta", true);
    const before = await checksum(join(root, "vendor", "aaaaaaa"));
    const result = await compose(root, "aaaaaaa");
    expect(result.problems).toEqual([]);
    const roster = JSON.parse(
      await readFile(
        join(result.dir, ".claude/skills/roast-room/roster.json"),
        "utf8",
      ),
    );
    expect(roster.seats.map((seat: { key: string }) => seat.key)).toEqual([
      "alpha",
      "risk",
    ]);
    expect(roster.default).toEqual(["alpha"]);
    const composed = await files(result.dir);
    expect(composed).toContain(".claude/agents/council-risk.md");
    expect(composed).toContain(
      ".claude/skills/roast-room/brains/brain-risk/brain.md",
    );
    expect(composed).toContain("app/public/portraits/risk.png");
    expect(await readlink(join(root, "runtime", "current"))).toBe(result.dir);
    expect(await readlink(join(result.dir, "sessions"))).toBe(
      join(root, "sessions"),
    );
    // Isolation: upstream is never edited and nothing is written elsewhere.
    expect(await checksum(join(root, "vendor", "aaaaaaa"))).toBe(before);
    expect(await files(outside)).toEqual(["untouched.txt"]);
  });
  it("refuses a registry advisor that has no agent or brain", async () => {
    await install("aaaaaaa");
    await write(
      root,
      "registry/advisors/ghost/advisor.json",
      JSON.stringify({ key: "ghost", name: "Ghost", slug: "brain-ghost" }),
    );
    const result = await compose(root, "aaaaaaa");
    expect(result.problems).toEqual([
      'Seat "ghost" has no agent file.',
      'Seat "ghost" has no brain.',
    ]);
    expect(await files(join(root, "runtime"))).toEqual([]);
  });
  it("reports a version that is not installed and rejects odd commit names", async () => {
    expect((await compose(root, "bbbbbbb")).problems).toEqual([
      "That version is not installed.",
    ]);
    await expect(compose(root, "../etc")).rejects.toThrow("Invalid commit");
  });
  it("lists seats with the ones the user switched off", async () => {
    expect(await seats(root)).toEqual([]);
    await install("aaaaaaa");
    await writeManifest(root, {
      repo: "o/r",
      current: { commit: "aaaaaaa", sha256: "x", validatedAt: "t" },
      previous: null,
      lastCheckedAt: null,
    });
    await setSeatDisabled(root, "beta", true);
    await setSeatDisabled(root, "beta", true);
    expect(await seats(root)).toEqual([
      { key: "alpha", name: "Advisor alpha", disabled: false },
      { key: "beta", name: "Advisor beta", disabled: true },
    ]);
    await setSeatDisabled(root, "beta", false);
    expect((await readRegistry(root)).disabled).toEqual([]);
  });
});

describe("validation", () => {
  it("names every problem in plain words", async () => {
    const dir = join(root, "candidate");
    await upstream(dir, { skill: "no front matter, only --quick" });
    await rm(join(dir, "app/server.mjs"));
    await rm(join(dir, ".claude/agents/council-beta.md"));
    expect((await validate(dir)).problems).toEqual([
      'Seat "beta" has no agent file.',
      "The Council skill has no readable front matter.",
      "The Council skill no longer mentions: --seats, --all, ask, board.",
      "The room server is missing.",
    ]);
    expect((await validate(join(root, "missing"))).problems).toEqual([
      "The roster file is missing or unreadable.",
    ]);
    await rm(join(dir, ".claude/skills/roast-room/SKILL.md"));
    expect((await validate(dir)).problems).toContain(
      "The Council skill file is missing.",
    );
  });
  it("checks that the room theme resolves for every Amun theme", async () => {
    const dir = join(root, "candidate");
    await upstream(dir);
    expect(
      (await validate(dir, { tokensCss, themes: ["dark"] })).problems,
    ).toEqual([]);
    const broken = await validate(dir, { tokensCss, themes: ["light"] });
    expect(broken.problems[0]).toBe(
      'Theme "light" has no value for --amun-color-canvas.',
    );
  });
});

describe("updates (plan §6)", () => {
  const options = {
    bundledNode: "24.22.1",
    now: new Date("2026-11-12T00:00:00Z"),
  };
  it("installs the first version", async () => {
    const result = await update(root, fetcher("aaaaaaa"), options);
    expect(result).toMatchObject({
      state: "applied",
      commit: "aaaaaaa",
      restart: "reload",
    });
    expect(await readManifest(root)).toMatchObject({
      current: { commit: "aaaaaaa", validatedAt: "2026-11-12T00:00:00.000Z" },
      previous: null,
      lastCheckedAt: "2026-11-12T00:00:00.000Z",
    });
    expect(await files(join(root, "staging"))).toEqual([]);
  });
  it("does nothing when upstream has not moved", async () => {
    await update(root, fetcher("aaaaaaa"), options);
    expect(await update(root, fetcher("aaaaaaa"), options)).toEqual({
      state: "current",
    });
  });
  it("applies a valid update, keeps the previous version and leaves the registry alone", async () => {
    await update(root, fetcher("aaaaaaa"), options);
    await write(
      root,
      "registry/advisors/risk/advisor.json",
      JSON.stringify({
        key: "risk",
        name: "Risk guardian",
        slug: "brain-risk",
      }),
    );
    await write(root, "registry/advisors/risk/agent.md", "risk agent");
    await write(root, "registry/advisors/risk/brain/brain.md", "risk brain");
    const registry = await checksum(join(root, "registry"));
    const result = await update(
      root,
      fetcher("bbbbbbb", {
        seats: ["alpha", "beta", "gamma"],
        extra: { "scripts/check_quotes.py": "print(1)" },
      }),
      options,
    );
    expect(result).toMatchObject({
      state: "applied",
      commit: "bbbbbbb",
      restart: "reload",
      executable: ["scripts/check_quotes.py"],
    });
    if (result.state === "applied")
      expect(result.changedFiles).toContain(
        ".claude/skills/roast-room/roster.json",
      );
    expect(await readManifest(root)).toMatchObject({
      current: { commit: "bbbbbbb" },
      previous: { commit: "aaaaaaa" },
    });
    expect(await readlink(join(root, "runtime", "current"))).toBe(
      join(root, "runtime", "bbbbbbb"),
    );
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
      "beta",
      "gamma",
      "risk",
    ]);
    expect(await checksum(join(root, "registry"))).toBe(registry);
  });
  it("rejects a broken update and keeps the current runtime", async () => {
    await update(root, fetcher("aaaaaaa"), options);
    const result = await update(
      root,
      fetcher("ccccccc", { roster: "{ not json" }),
      options,
    );
    expect(result).toEqual({
      state: "rejected",
      commit: "ccccccc",
      problems: ["The roster file is missing or unreadable."],
    });
    const missingBrain = await update(
      root,
      fetcher("ddddddd", {
        roster: JSON.stringify({
          seats: [{ key: "zeta", name: "Z", slug: "brain-zeta" }],
        }),
      }),
      options,
    );
    expect(missingBrain).toMatchObject({
      state: "rejected",
      problems: ['Seat "zeta" has no agent file.', 'Seat "zeta" has no brain.'],
    });
    expect((await readManifest(root)).current?.commit).toBe("aaaaaaa");
    expect(await readlink(join(root, "runtime", "current"))).toBe(
      join(root, "runtime", "aaaaaaa"),
    );
    expect(await files(join(root, "vendor", "ddddddd"))).toEqual([]);
  });
  it("reports a download that failed", async () => {
    const failing: Fetcher = {
      head: async () => "eeeeeee",
      download: async () => {
        throw Error("offline");
      },
    };
    expect(await update(root, failing, options)).toEqual({
      state: "rejected",
      commit: "eeeeeee",
      problems: ["The update could not be downloaded: offline"],
    });
    await expect(
      update(
        root,
        { head: async () => "not a commit", download: async () => undefined },
        options,
      ),
    ).rejects.toThrow();
  });
  it("asks for an Amun restart only for a newer Node or a changed session format", async () => {
    await update(root, fetcher("aaaaaaa"), options);
    const newerNode = await update(
      root,
      fetcher("bbbbbbb", {}, ">=26"),
      options,
    );
    expect(newerNode).toMatchObject({ state: "applied", restart: "restart" });
    const contract = await update(
      root,
      fetcher("ccccccc", {
        extra: { ".claude/skills/roast-room/references/live-room.md": "v2" },
      }),
      options,
    );
    expect(contract).toMatchObject({
      state: "applied",
      restart: "restart",
      reasons: ["The session format Amun reads has changed."],
    });
  });
  it("rolls back to the previous version", async () => {
    expect(await rollback(root)).toEqual({
      ok: false,
      problems: ["There is no earlier version to return to."],
    });
    await update(root, fetcher("aaaaaaa"), options);
    await update(root, fetcher("bbbbbbb", { seats: ["alpha"] }), options);
    expect(await rollback(root)).toEqual({ ok: true, commit: "aaaaaaa" });
    expect(await readManifest(root)).toMatchObject({
      current: { commit: "aaaaaaa" },
      previous: { commit: "bbbbbbb" },
    });
    expect(await readlink(join(root, "runtime", "current"))).toBe(
      join(root, "runtime", "aaaaaaa"),
    );
  });
});

describe("Chair question bridge", () => {
  const input = {
    questions: [
      {
        question: "What is the budget?",
        options: [{ label: "Under 1M" }, { label: "Over 1M" }],
      },
    ],
  };
  it("holds a question until the owner answers", async () => {
    const dir = join(root, "bridge");
    expect(await pending(dir)).toEqual([]);
    await ask(dir, "q1", input, new Date("2026-11-12T00:00:00Z"));
    expect(await pending(dir)).toEqual([
      {
        id: "q1",
        askedAt: "2026-11-12T00:00:00.000Z",
        questions: [
          {
            question: "What is the budget?",
            options: ["Under 1M", "Over 1M"],
            multiSelect: false,
          },
        ],
      },
    ]);
    const waiting = waitForAnswer(dir, "q1", { intervalMs: 5 });
    await answer(dir, "q1", ["Under 1M"]);
    expect(await waiting).toEqual(["Under 1M"]);
    expect(await pending(dir)).toEqual([]);
    expect(await files(dir)).toEqual([]);
  });
  it("ignores malformed files and refuses empty or unsafe questions", async () => {
    const dir = join(root, "bridge");
    await write(dir, "question-bad.json", "{ nope");
    await write(
      dir,
      "question-other.json",
      JSON.stringify({ id: "different", questions: input.questions }),
    );
    await write(dir, "notes.txt", "x");
    expect(await pending(dir)).toEqual([]);
    await expect(ask(dir, "q2", { questions: [] })).rejects.toThrow(
      "No question to ask",
    );
    await expect(ask(dir, "../x", input)).rejects.toThrow(
      "Invalid question id",
    );
    await expect(answer(dir, "a/b", [])).rejects.toThrow();
  });
  it("can be withdrawn while waiting", async () => {
    const dir = join(root, "bridge");
    await ask(dir, "q3", input);
    const controller = new AbortController();
    const waiting = waitForAnswer(dir, "q3", {
      intervalMs: 5,
      signal: controller.signal,
    });
    controller.abort();
    await expect(waiting).rejects.toThrow("Question withdrawn");
  });
});

describe("owner-question tool server", () => {
  const request = (method: string, params?: Record<string, unknown>) => ({
    jsonrpc: "2.0" as const,
    id: 1,
    method,
    ...(params ? { params } : {}),
  });
  it("speaks enough of the protocol for Claude Code to list and call the tool", async () => {
    const dir = join(root, "bridge");
    expect(
      await handle(
        request("initialize", { protocolVersion: "2025-03-26" }),
        dir,
      ),
    ).toMatchObject({
      result: { protocolVersion: "2025-03-26", capabilities: { tools: {} } },
    });
    expect(await handle(request("initialize"), dir)).toMatchObject({
      result: { protocolVersion: "2025-06-18" },
    });
    expect(
      await handle(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        dir,
      ),
    ).toBeNull();
    expect(await handle(request("ping"), dir)).toMatchObject({ result: {} });
    const list = (await handle(request("tools/list"), dir)) as {
      result: { tools: { name: string }[] };
    };
    expect(list.result.tools.map((tool) => tool.name)).toEqual([toolName]);
    expect(await handle(request("resources/list"), dir)).toMatchObject({
      error: { code: -32601 },
    });
    expect(
      await handle(request("tools/call", { name: "other" }), dir),
    ).toMatchObject({ error: { code: -32602 } });
  });
  it("returns the owner's answer to the Chair", async () => {
    const dir = join(root, "bridge");
    const call = handle(
      request("tools/call", {
        name: toolName,
        arguments: {
          questions: [
            { question: "What is the budget?" },
            { question: "Deadline?" },
          ],
        },
      }),
      dir,
      { intervalMs: 5 },
    );
    let waitingOn = await pending(dir);
    for (let tries = 0; !waitingOn.length && tries < 100; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      waitingOn = await pending(dir);
    }
    expect(waitingOn).toHaveLength(1);
    await answer(dir, waitingOn[0]!.id, ["Under 1M"]);
    expect(await call).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [
          {
            type: "text",
            text: "What is the budget?\nAnswer: Under 1M\n\nDeadline?\nAnswer: ",
          },
        ],
      },
    });
  });
  it("tells the Chair when a question could not be asked", async () => {
    expect(
      await handle(
        request("tools/call", { name: toolName, arguments: {} }),
        join(root, "bridge"),
      ),
    ).toMatchObject({
      result: { isError: true, content: [{ text: "No question to ask" }] },
    });
  });
});
