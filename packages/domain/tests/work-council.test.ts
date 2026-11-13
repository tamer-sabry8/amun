import { describe, expect, it } from "vitest";
import {
  askToolName,
  chairInvocation,
  chairQuestions,
  classifyUpdate,
  composeRoster,
  councilCommands,
  emptyManifest,
  executableChanges,
  missingCommands,
  parseCouncilCommand,
  promote,
  rollback,
  roomThemeCss,
  suggestFullCouncil,
  themeMap,
  themeTokens,
  updateDue,
  upstreamCommand,
  validateRoster,
  verdictOutputs,
  type CouncilSession,
  type Roster,
} from "../src/work/council.ts";

describe("Council commands (plan §1, §7)", () => {
  it("lists every upstream command for the / menu", () => {
    expect(councilCommands.map((command) => command.name)).toEqual([
      "roast-room",
      "roast-room ask",
      "roast-room board",
      "newroaster",
      "newroaster portrait",
    ]);
  });
  it("defaults to quick and honours the flags", () => {
    expect(parseCouncilCommand("/roast-room Should we sunset v1?")).toEqual({
      kind: "council",
      decision: "Should we sunset v1?",
      mode: "quick",
      seats: [],
    });
    expect(
      parseCouncilCommand("/roast-room Raise prices", { defaultMode: "full" }),
    ).toMatchObject({ mode: "full" });
    expect(
      parseCouncilCommand("/roast-room Raise prices --quick"),
    ).toMatchObject({
      mode: "quick",
      decision: "Raise prices",
    });
    expect(parseCouncilCommand("/roast-room Raise prices --all")).toMatchObject(
      { mode: "all" },
    );
    expect(
      parseCouncilCommand("/roast-room Raise prices --seats Jobs, Munger"),
    ).toMatchObject({
      mode: "seats",
      seats: ["jobs"],
    });
    expect(
      parseCouncilCommand("/roast-room Raise prices --seats jobs,munger"),
    ).toMatchObject({
      seats: ["jobs", "munger"],
      decision: "Raise prices",
    });
  });
  it("parses ask, board, newroaster and portrait", () => {
    expect(parseCouncilCommand("/roast-room ask Munger Is this wise?")).toEqual(
      {
        kind: "ask",
        seat: "munger",
        question: "Is this wise?",
      },
    );
    expect(parseCouncilCommand("/roast-room board")).toEqual({
      kind: "board",
      instruction: "",
    });
    expect(
      parseCouncilCommand("/roast-room board always include a sceptic"),
    ).toEqual({
      kind: "board",
      instruction: "always include a sceptic",
    });
    expect(
      parseCouncilCommand(
        '/newroaster Jane Doe --deep --pillar "pricing strategy" --default',
      ),
    ).toEqual({
      kind: "newroaster",
      name: "Jane Doe",
      depth: "deep",
      pillar: "pricing strategy",
      makeDefault: true,
    });
    expect(parseCouncilCommand("/newroaster Jane Doe --quick")).toMatchObject({
      depth: "quick",
      pillar: null,
      makeDefault: false,
    });
    expect(parseCouncilCommand("/newroaster Jane Doe")).toMatchObject({
      depth: "default",
    });
    expect(parseCouncilCommand("/newroaster portrait Jane Doe")).toEqual({
      kind: "portrait",
      name: "Jane Doe",
    });
  });
  it("explains malformed commands and ignores other text", () => {
    expect(parseCouncilCommand("/roast-room")).toMatchObject({ kind: "error" });
    expect(parseCouncilCommand("/roast-room ask")).toMatchObject({
      kind: "error",
    });
    expect(parseCouncilCommand("/roast-room x --quick --all")).toMatchObject({
      kind: "error",
    });
    expect(parseCouncilCommand("/roast-room x --seats ,")).toMatchObject({
      kind: "error",
    });
    expect(parseCouncilCommand("/newroaster")).toMatchObject({ kind: "error" });
    expect(parseCouncilCommand("/prd")).toBeNull();
    expect(parseCouncilCommand("roast this")).toBeNull();
  });
  it("produces the exact upstream invocation text", () => {
    const text = (input: string, options = {}) =>
      upstreamCommand(parseCouncilCommand(input, options)!);
    expect(text("/roast-room Raise prices")).toBe(
      "/roast-room Raise prices --quick",
    );
    expect(text("/roast-room Raise prices", { defaultMode: "full" })).toBe(
      "/roast-room Raise prices",
    );
    expect(text("/roast-room Raise prices --seats a,b")).toBe(
      "/roast-room Raise prices --seats a,b",
    );
    expect(text("/roast-room Raise prices --all")).toBe(
      "/roast-room Raise prices --all",
    );
    expect(text("/roast-room ask munger Why?")).toBe(
      "/roast-room ask munger Why?",
    );
    expect(text("/roast-room board")).toBe("/roast-room board");
    expect(text("/roast-room board add a sceptic")).toBe(
      "/roast-room board add a sceptic",
    );
    expect(
      text('/newroaster Jane Doe --deep --pillar "pricing" --default'),
    ).toBe('/newroaster Jane Doe --deep --pillar "pricing" --default');
    expect(text("/newroaster Jane Doe --quick")).toBe(
      "/newroaster Jane Doe --quick",
    );
    expect(text("/newroaster portrait Jane Doe")).toBe(
      "/newroaster portrait Jane Doe",
    );
    expect(text("/roast-room")).toBeNull();
  });
});

describe("Chair run and question bridge", () => {
  it("runs Claude Code headless with the owner-question tool and no shell", () => {
    const run = chairInvocation({
      command: parseCouncilCommand("/roast-room Raise prices")!,
      mcpConfigPath: "/data/mcp.json",
      context: "BRD v2 summary",
    })!;
    expect(run.args).toContain("stream-json");
    expect(
      run.args.slice(
        run.args.indexOf("--mcp-config"),
        run.args.indexOf("--mcp-config") + 2,
      ),
    ).toEqual(["--mcp-config", "/data/mcp.json"]);
    const allowed =
      run.args[run.args.indexOf("--allowedTools") + 1]!.split(",");
    expect(allowed).toContain(askToolName);
    expect(allowed).not.toContain("Bash");
    expect(run.args).toContain("--strict-mcp-config");
    expect(run.args.at(-1)).toContain("AskUserQuestion is unavailable");
    const message = JSON.parse(run.stdin);
    expect(message.message.content).toBe(
      "/roast-room Raise prices --quick\n\nContext you may use:\nBRD v2 summary",
    );
    expect(
      JSON.parse(
        chairInvocation({
          command: parseCouncilCommand("/roast-room board")!,
          mcpConfigPath: "x",
        })!.stdin,
      ).message.content,
    ).toBe("/roast-room board");
    expect(
      chairInvocation({
        command: { kind: "error", message: "x" },
        mcpConfigPath: "x",
      }),
    ).toBeNull();
  });
  it("turns the Chair's tool input into Island questions", () => {
    expect(
      chairQuestions({
        questions: [
          {
            question: " What is the budget? ",
            options: [{ label: "Under 1M" }, "Over 1M", 7, { nope: true }],
            multiSelect: true,
          },
          { question: "" },
          "junk",
          { question: "Free text?" },
        ],
      }),
    ).toEqual([
      {
        question: "What is the budget?",
        options: ["Under 1M", "Over 1M"],
        multiSelect: true,
      },
      { question: "Free text?", options: [], multiSelect: false },
    ]);
    expect(chairQuestions(null)).toEqual([]);
    expect(chairQuestions({ questions: "no" })).toEqual([]);
  });
});

const upstream: Roster = {
  seats: [
    { key: "a", name: "Advisor A", slug: "advisor-a" },
    { key: "b", name: "Advisor B", slug: "advisor-b" },
    { key: "c", name: "Advisor C", slug: "advisor-c" },
  ],
  board: "ask",
  default: ["a", "b"],
  version: 3,
};

describe("roster composition (plan §3)", () => {
  it("removes disabled seats, adds registry advisors and applies the board override", () => {
    const composed = composeRoster(upstream, {
      advisors: [{ key: "risk", name: "Risk guardian", slug: "risk-guardian" }],
      disabled: ["b"],
      board: { board: "default", default: ["a", "b", "risk"] },
    });
    expect(composed.seats.map((seat) => seat.key)).toEqual(["a", "c", "risk"]);
    expect(composed.board).toBe("default");
    expect(composed.default).toEqual(["a", "risk"]);
    expect(composed.version).toBe(3);
  });
  it("lets a registry advisor replace an upstream seat with the same key", () => {
    const composed = composeRoster(upstream, {
      advisors: [{ key: "a", name: "Edited A", slug: "advisor-a" }],
      disabled: [],
      board: null,
    });
    expect(composed.seats.map((seat) => seat.name)).toEqual([
      "Advisor B",
      "Advisor C",
      "Edited A",
    ]);
    expect(composed.board).toBe("ask");
    expect(composed.default).toEqual(["a", "b"]);
  });
  it("leaves the upstream object untouched and tolerates a missing board", () => {
    const copy = structuredClone(upstream);
    composeRoster(upstream, { advisors: [], disabled: ["a"], board: null });
    expect(upstream).toEqual(copy);
    expect(
      composeRoster({ seats: [] }, { advisors: [], disabled: [], board: null }),
    ).toEqual({ seats: [] });
  });
  it("requires an agent and a brain for every seat", () => {
    const has = {
      agent: (key: string) => key !== "c",
      brain: (slug: string) => slug !== "advisor-b",
    };
    expect(validateRoster(upstream, has)).toEqual([
      'Seat "b" has no brain.',
      'Seat "c" has no agent file.',
    ]);
    const ok = { agent: () => true, brain: () => true };
    expect(validateRoster(upstream, ok)).toEqual([]);
    expect(validateRoster({}, ok)).toEqual([
      "The roster file has no list of seats.",
    ]);
    expect(validateRoster({ seats: [] }, ok)).toEqual([
      "The roster has no seats.",
    ]);
    expect(
      validateRoster(
        {
          seats: [
            { key: "a", slug: "s" },
            { key: "a", slug: "s" },
            { name: "x" },
          ],
        },
        ok,
      ),
    ).toEqual([
      'Seat "a" is listed twice.',
      "A seat is missing its key or brain name.",
    ]);
  });
  it("checks the skill still advertises the commands Amun exposes", () => {
    expect(missingCommands("--quick --seats --all ask board")).toEqual([]);
    expect(missingCommands("--quick only")).toEqual([
      "--seats",
      "--all",
      "ask",
      "board",
    ]);
  });
});

describe("updates (plan §6)", () => {
  it("reloads in place for prompts, brains and app files", () => {
    expect(
      classifyUpdate({
        changedFiles: [
          "roster.json",
          "app/server.mjs",
          ".claude/agents/council-a.md",
        ],
        bundledNode: "24.22.1",
      }),
    ).toEqual({ class: "reload", reasons: [] });
  });
  it("needs an Amun restart for a newer Node or a changed session contract", () => {
    expect(
      classifyUpdate({
        changedFiles: [],
        requiredNode: ">=26",
        bundledNode: "24.22.1",
      }),
    ).toEqual({
      class: "restart",
      reasons: ["Needs Node >=26; Amun ships 24.22.1."],
    });
    expect(
      classifyUpdate({
        changedFiles: [".claude/skills/roast-room/references/live-room.md"],
        requiredNode: ">=20",
        bundledNode: "24.22.1",
      }),
    ).toMatchObject({ class: "restart" });
  });
  it("notes executable changes", () => {
    expect(
      executableChanges(["a.md", "app/server.mjs", "scripts/check_quotes.py"]),
    ).toEqual(["app/server.mjs", "scripts/check_quotes.py"]);
  });
  it("promotes a validated candidate and keeps the previous one for rollback", () => {
    const first = promote(emptyManifest, { commit: "c1", sha256: "s1" }, "t1");
    const second = promote(first, { commit: "c2", sha256: "s2" }, "t2");
    expect(second).toMatchObject({
      current: { commit: "c2", validatedAt: "t2" },
      previous: { commit: "c1", validatedAt: "t1" },
    });
    expect(promote(second, { commit: "c2", sha256: "s2" }, "t3")).toBe(second);
    expect(rollback(second)).toMatchObject({
      current: { commit: "c1" },
      previous: { commit: "c2" },
    });
    expect(rollback(first)).toBeNull();
  });
  it("checks weekly once a source is configured", () => {
    const now = Date.parse("2026-11-12T00:00:00Z");
    expect(updateDue(emptyManifest, now)).toBe(false);
    const manifest = { ...emptyManifest, repo: "owner/repo" };
    expect(updateDue(manifest, now)).toBe(true);
    expect(
      updateDue({ ...manifest, lastCheckedAt: "2026-11-10T00:00:00Z" }, now),
    ).toBe(false);
    expect(
      updateDue({ ...manifest, lastCheckedAt: "2026-11-01T00:00:00Z" }, now),
    ).toBe(true);
  });
});

describe("theme mapping (plan §5)", () => {
  const css = `[data-theme="one"] {\n  --amun-color-canvas: #000;\n  --amun-font-ui: "Inter", "sans-serif";\n}\n[data-theme="two"] {\n  --amun-color-canvas: #fff;\n}\n`;
  it("reads one theme block", () => {
    expect(themeTokens(css, "one")).toEqual({
      "--amun-color-canvas": "#000",
      "--amun-font-ui": '"Inter", "sans-serif"',
    });
    expect(themeTokens(css, "missing")).toEqual({});
  });
  it("maps every room variable and reports unresolved ones", () => {
    const tokens = Object.fromEntries(
      themeMap.map(([, amun]) => [amun, "#123456"]),
    );
    const full = roomThemeCss(tokens);
    expect(full.missing).toEqual([]);
    for (const [room] of themeMap)
      expect(full.css).toContain(`  ${room}: #123456;`);
    expect(roomThemeCss(themeTokens(css, "one")).missing).toContain(
      "--amun-color-accent",
    );
  });
});

describe("verdicts (Q62)", () => {
  const session = (extra: Partial<CouncilSession>): CouncilSession => ({
    id: "s",
    decision: "Raise prices",
    groupId: "employer",
    workAreaId: "w",
    mode: "quick",
    state: "finished",
    recommendation: "Raise by 10% for new customers",
    createdAt: "2026-11-12",
    ...extra,
  });
  it("sends the report to the Library and the recommendation to Decisions", () => {
    expect(verdictOutputs(session({}))).toEqual({
      library: {
        type: "council_report",
        title: "Council · Raise prices",
        groupId: "employer",
        workAreaIds: ["w"],
      },
      decision: {
        what: "Raise prices",
        options: ["Raise by 10% for new customers"],
        source: "council",
        outcome: null,
        groupId: "employer",
        workAreaId: "w",
      },
      changesRoadmapOrTickets: false,
    });
  });
  it("supports an intentionally unlinked session with no actionable recommendation", () => {
    const outputs = verdictOutputs(
      session({ workAreaId: null, recommendation: null }),
    );
    expect(outputs.library?.workAreaIds).toEqual([]);
    expect(outputs.decision).toBeNull();
  });
  it("produces nothing until the council has finished", () => {
    expect(verdictOutputs(session({ state: "running" }))).toEqual({
      library: null,
      decision: null,
    });
  });
  it("suggests a full council for costly or irreversible decisions", () => {
    expect(suggestFullCouncil("Should we sunset the v1 API?")).toBe(true);
    expect(suggestFullCouncil("Sign a multi-year contract")).toBe(true);
    expect(suggestFullCouncil("Rename the settings tab")).toBe(false);
  });
});
