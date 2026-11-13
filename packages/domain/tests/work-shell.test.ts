import { describe, expect, it } from "vitest";
import {
  builtInCommands,
  composerTrigger,
  dictation,
  initialShell,
  initialWizard,
  islandPresentation,
  leaksRuntimeVocabulary,
  matchCommands,
  matchMentions,
  modelsLine,
  railItems,
  resolveTheme,
  modelDisplay,
  routingLabel,
  shellReducer,
  sidebarCollapsed,
  tiles,
  unresolvedRoutes,
  wizardReducer,
  type ShellAction,
  type WizardAction,
} from "../src/work/shell.ts";
import {
  calendarNote,
  decisionLog,
  horizonBoard,
  library,
  moveStory,
  orgChart,
  teamUnder,
  planSummary,
  pullStats,
  releaseGroups,
  resequence,
  riceBadge,
  sprintOverview,
  sprintRow,
  timelineBar,
  type AgentCard,
  type Decision,
  type LibraryItem,
  type RoadmapItem,
  type Sprint,
  type SprintPlan,
} from "../src/work/planning.ts";

const run = (actions: ShellAction[]) =>
  actions.reduce(shellReducer, initialShell);

describe("navigation v3", () => {
  it("has six tiles in the confirmed order and a four-item rail", () => {
    expect(tiles.map(([, label]) => label)).toEqual([
      "Agents",
      "Council",
      "Roadmap",
      "Sprints",
      "Portfolio",
      "RFPs",
    ]);
    expect(railItems.map(([, label]) => label)).toEqual([
      "Activity",
      "Downloads",
      "Library",
      "Decisions",
    ]);
  });
  it("keeps runtime vocabulary off primary surfaces", () => {
    expect(leaksRuntimeVocabulary("Add an agent")).toBeNull();
    expect(leaksRuntimeVocabulary("Open the worktree")).toBe("worktree");
    expect(leaksRuntimeVocabulary("Sign in with Pi")).toBe("Pi");
    expect(leaksRuntimeVocabulary("Pick a pilot")).toBeNull();
  });
});

describe("shellReducer", () => {
  it("opens a work area straight into its conversation", () => {
    expect(run([{ type: "open_work", workAreaId: "w" }])).toMatchObject({
      route: "work",
      workAreaId: "w",
    });
  });
  it("collapses the sidebar while an artifact is open and restores it after", () => {
    const open = run([
      { type: "open_work", workAreaId: "w" },
      { type: "artifact", open: true },
    ]);
    expect(sidebarCollapsed(open)).toBe(true);
    const closed = shellReducer(open, { type: "artifact", open: false });
    expect(sidebarCollapsed(closed)).toBe(false);
  });
  it("keeps a sidebar the user collapsed themselves", () => {
    const state = run([
      { type: "toggle_sidebar" },
      { type: "artifact", open: true },
      { type: "artifact", open: false },
    ]);
    expect(sidebarCollapsed(state)).toBe(true);
    expect(
      sidebarCollapsed(shellReducer(state, { type: "toggle_sidebar" })),
    ).toBe(false);
  });
  it("lets the user expand the sidebar during a work session", () => {
    const state = run([
      { type: "artifact", open: true },
      { type: "toggle_sidebar" },
    ]);
    expect(sidebarCollapsed(state)).toBe(false);
  });
  it("clamps the divider and supports expand and restore", () => {
    expect(run([{ type: "resize", ratio: 0.05 }]).artifact.ratio).toBe(0.28);
    expect(run([{ type: "resize", ratio: 0.95 }]).artifact.ratio).toBe(0.72);
    const expanded = run([
      { type: "resize", ratio: 0.6 },
      { type: "expand_artifact" },
    ]);
    expect(expanded.artifact).toMatchObject({ expanded: true, ratio: 1 });
    expect(
      shellReducer(expanded, { type: "expand_artifact" }).artifact,
    ).toMatchObject({
      expanded: false,
      ratio: 0.6,
    });
  });
  it("leaving a work session closes the artifact and clears the work area", () => {
    const state = run([
      { type: "open_work", workAreaId: "w" },
      { type: "artifact", open: true },
      { type: "go", route: "roadmap" },
    ]);
    expect(state).toMatchObject({
      route: "roadmap",
      workAreaId: null,
      autoCollapsed: false,
    });
    expect(state.artifact.open).toBe(false);
  });
  it("toggles rail panels, expands them into the workspace, and the palette", () => {
    const state = run([
      { type: "rail", item: "library" },
      { type: "expand_rail" },
    ]);
    expect(state).toMatchObject({ rail: "library", railExpanded: true });
    expect(
      shellReducer(state, { type: "rail", item: "library" }).rail,
    ).toBeNull();
    expect(
      shellReducer(state, { type: "rail", item: "decisions" }),
    ).toMatchObject({
      rail: "decisions",
      railExpanded: false,
    });
    expect(run([{ type: "expand_rail" }]).railExpanded).toBe(false);
    expect(run([{ type: "palette", open: true }]).palette).toBe(true);
  });
});

describe("Island (Q31–Q32)", () => {
  const base = {
    collapsed: true,
    newItemAt: 1000,
    now: 3000,
    reducedMotion: false,
    hovered: false,
  };
  it("is a card in the open sidebar", () => {
    expect(islandPresentation({ ...base, collapsed: false })).toEqual({
      mode: "card",
      stealFocus: false,
    });
  });
  it("floats for about six seconds, then returns to the badge", () => {
    expect(islandPresentation(base).mode).toBe("floating");
    expect(islandPresentation({ ...base, now: 7001 }).mode).toBe("badge");
    expect(islandPresentation({ ...base, newItemAt: null }).mode).toBe("badge");
  });
  it("respects reduced motion, reopens on hover and never takes focus", () => {
    expect(islandPresentation({ ...base, reducedMotion: true }).mode).toBe(
      "badge",
    );
    expect(islandPresentation({ ...base, now: 99999, hovered: true })).toEqual({
      mode: "floating",
      stealFocus: false,
    });
  });
});

describe("composer (Q27, Q70)", () => {
  it("opens / only at the start and @ anywhere", () => {
    expect(composerTrigger("/spr")).toEqual({ trigger: "/", query: "spr" });
    expect(composerTrigger("hello /spr")).toBeNull();
    expect(composerTrigger("ask @res")).toEqual({ trigger: "@", query: "res" });
    expect(composerTrigger("@")).toEqual({ trigger: "@", query: "" });
    expect(composerTrigger("mail a@b.com")).toBeNull();
    expect(composerTrigger("ask @res now", 8)).toEqual({
      trigger: "@",
      query: "res",
    });
    expect(composerTrigger("plain text")).toBeNull();
  });
  it("matches commands by prefix, including two-word commands", () => {
    expect(matchCommands(builtInCommands, "sp").map((c) => c.name)).toEqual([
      "sprint plan",
    ]);
    expect(
      matchCommands(builtInCommands, "research the market").map((c) => c.name),
    ).toEqual(["research"]);
    expect(matchCommands(builtInCommands, "").length).toBe(
      builtInCommands.length,
    );
  });
  it("mentions agents and work areas", () => {
    expect(
      matchMentions(
        "re",
        [{ id: "1", name: "Researcher" }],
        [{ id: "w", name: "Reporting" }],
      ),
    ).toEqual([
      { kind: "agent", id: "1", name: "Researcher" },
      { kind: "work", id: "w", name: "Reporting" },
    ]);
  });
  it("shows the routing state and keeps dictation in the box", () => {
    expect(routingLabel("Sonnet 5.5")).toBe("Sonnet 5.5");
    expect(modelDisplay("github-copilot/claude-sonnet-5")).toBe(
      "GitHub Copilot · Claude Sonnet 5",
    );
    expect(modelDisplay("openai-codex/gpt-5.2-codex")).toBe(
      "ChatGPT · GPT 5.2 Codex",
    );
    expect(modelDisplay("mistral-large")).toBe("Mistral Large");
    expect(modelDisplay("openai/unknown")).toBeNull();
    expect(modelDisplay(null)).toBeNull();
    expect(routingLabel("Opus 5.5", true)).toBe("Chosen · Opus 5.5");
    expect(routingLabel(null)).toBe("Auto");
    expect(dictation("Plan ", " sprint 15 ")).toEqual({
      draft: "Plan sprint 15",
      send: false,
    });
    expect(dictation("", "hello")).toEqual({ draft: "hello", send: false });
  });
});

describe("wizard (handoff §5)", () => {
  const go = (actions: WizardAction[]) =>
    actions.reduce(wizardReducer, initialWizard);
  it("runs four skippable steps and never starts work", () => {
    expect(initialWizard.step).toBe("models");
    const steps = [1, 2, 3].map(
      (count) =>
        go(Array.from({ length: count }, () => ({ type: "next" as const })))
          .step,
    );
    expect(steps).toEqual(["tools", "work", "agents"]);
    const finished = go(
      Array.from({ length: 4 }, () => ({ type: "next" as const })),
    );
    expect(finished.done).toBe(true);
    expect(go([{ type: "back" }]).step).toBe("models");
    expect(go([{ type: "next" }, { type: "back" }]).step).toBe("models");
  });
  it("preselects the day-one agents without an Engineer", () => {
    expect(initialWizard.agents).toHaveLength(20);
    expect(initialWizard.agents.slice(0, 3)).toEqual([
      "Research & Insights",
      "Product Manager",
      "UX",
    ]);
    expect(initialWizard.agents.some((name) => /engineer/i.test(name))).toBe(
      false,
    );
    expect(
      go([{ type: "toggle", field: "agents", value: "UX" }]).agents,
    ).not.toContain("UX");
    expect(
      go([{ type: "toggle", field: "tools", value: "ado" }]).tools,
    ).toEqual(["ado"]);
  });
  it("adds, renames and removes groups and records only chosen routes", () => {
    const state = go([
      { type: "group", name: "Employer" },
      { type: "group", name: "Personal" },
      { type: "group", name: "  " },
      { type: "rename_group", from: "Employer", to: "Tahaluf" },
      { type: "rename_group", from: "Tahaluf", to: "Personal" },
      {
        type: "route",
        group: "Tahaluf",
        condition: "delivery",
        tracker: "ado",
      },
      { type: "route", group: "Tahaluf", condition: null, tracker: "notion" },
      { type: "route", group: "Tahaluf", condition: null, tracker: "github" },
    ]);
    expect(state.groups).toEqual([
      {
        name: "Tahaluf",
        routes: [
          { condition: "delivery", tracker: "ado" },
          { condition: null, tracker: "github" },
        ],
      },
      { name: "Personal", routes: [] },
    ]);
    expect(unresolvedRoutes(state)).toEqual(["Personal"]);
    expect(
      wizardReducer(state, { type: "group", name: "Personal" }).groups,
    ).toHaveLength(1);
  });
  it("summarises model choices in one line", () => {
    expect(modelsLine(6)).toBe("Models picked for 6 task types · Review");
    expect(modelsLine(1)).toBe("Models picked for 1 task type · Review");
    expect(modelsLine(0)).toBe("Sign in to pick models");
  });
  it("follows macOS appearance unless overridden (Q69)", () => {
    expect(resolveTheme({ choice: "system", systemDark: false })).toBe(
      "amun-light",
    );
    expect(resolveTheme({ choice: "system", systemDark: true })).toBe(
      "tamer-sabry-default",
    );
    expect(
      resolveTheme({
        choice: "system",
        systemDark: true,
        lastDark: "navy-gold",
      }),
    ).toBe("navy-gold");
    expect(resolveTheme({ choice: "navy-cyan", systemDark: false })).toBe(
      "navy-cyan",
    );
  });
});

const road = (extra: Partial<RoadmapItem>): RoadmapItem => ({
  id: "i",
  workAreaId: "w",
  title: "Item",
  horizon: "now",
  position: 0,
  committed: false,
  estimated: false,
  release: null,
  start: null,
  end: null,
  reach: null,
  impact: null,
  confidence: null,
  effort: null,
  ...extra,
});

describe("roadmap (Q37, Q63)", () => {
  it("shows a RICE badge only when scored and marks guesses", () => {
    expect(riceBadge(road({}))).toBeNull();
    expect(
      riceBadge(
        road({
          reach: 100,
          impact: 2,
          confidence: 50,
          effort: 2,
          estimated: true,
        }),
      ),
    ).toEqual({ text: "RICE 50", estimated: true, label: "estimated" });
    expect(
      riceBadge(road({ reach: 100, impact: 2, confidence: 50, effort: 2 }))
        ?.label,
    ).toBeNull();
  });
  it("lays out Now / Next / Later in order", () => {
    const board = horizonBoard([
      road({ id: "b", position: 1 }),
      road({ id: "a", position: 0 }),
      road({ id: "c", horizon: "later" }),
    ]);
    expect(board.map((column) => column.items.map((item) => item.id))).toEqual([
      ["a", "b"],
      [],
      ["c"],
    ]);
  });
  it("applies a draft move at once", () => {
    const result = resequence(
      [road({ id: "a", position: 0 }), road({ id: "b", position: 1 })],
      { id: "b", horizon: "now", index: 0 },
    );
    expect(result.apply).toBe(true);
    if (result.apply)
      expect(
        horizonBoard(result.items)[0]!.items.map((item) => item.id),
      ).toEqual(["b", "a"]);
  });
  it("turns a committed move into a proposal that needs approval", () => {
    const result = resequence(
      [road({ id: "a", committed: true }), road({ id: "b", position: 1 })],
      { id: "a", horizon: "later", index: 0 },
    );
    expect(result).toMatchObject({ apply: false, needsApproval: true });
    if (!result.apply)
      expect(result.proposal.find((item) => item.id === "a")!.horizon).toBe(
        "later",
      );
  });
  it("ignores an unknown item and a committed item dropped where it was", () => {
    const items = [road({ id: "a", committed: true })];
    expect(resequence(items, { id: "zz", horizon: "now", index: 0 })).toEqual({
      apply: true,
      items,
    });
    expect(resequence(items, { id: "a", horizon: "now", index: 5 }).apply).toBe(
      true,
    );
  });
  it("groups by release with unscheduled last and places timeline bars", () => {
    expect(
      releaseGroups([
        road({ id: "u" }),
        road({ id: "b", release: "R2" }),
        road({ id: "a", release: "R1" }),
      ]).map((group) => group.release),
    ).toEqual(["R1", "R2", "Unscheduled"]);
    const range = { start: "2026-11-01", end: "2026-12-01" };
    expect(
      timelineBar({ start: "2026-11-16", end: "2026-12-01" }, range),
    ).toEqual({
      left: 0.5,
      width: 0.5,
    });
    expect(
      timelineBar({ start: "2026-10-01", end: "2026-11-16" }, range),
    ).toEqual({
      left: 0,
      width: 0.5,
    });
    expect(timelineBar({ start: null, end: null }, range)).toBeNull();
    expect(
      timelineBar({ start: "2027-01-01", end: "2027-02-01" }, range),
    ).toBeNull();
    expect(
      timelineBar(
        { start: "2026-11-01", end: "2026-11-02" },
        { start: "x", end: "x" },
      ),
    ).toBeNull();
  });
});

describe("sprints (Q35, Q67)", () => {
  const now = Date.parse("2026-11-12T00:00:00Z");
  const sprint = (extra: Partial<Sprint>): Sprint => ({
    id: "s",
    workAreaId: "w",
    workAreaName: "TICAO",
    name: "Sprint 14",
    team: "Platform team",
    start: "2026-11-09T00:00:00Z",
    end: "2026-11-22T00:00:00Z",
    goal: "Complete approval workflows",
    draft: false,
    done: 6,
    total: 12,
    blocked: 1,
    changedInAdo: true,
    ...extra,
  });
  it("describes a running sprint", () => {
    expect(sprintRow(sprint({}), now)).toEqual({
      title: "TICAO · Sprint 14",
      progress: "6 / 12 stories done",
      timing: "10 days left",
      flags: ["1 blocked", "Changed in ADO"],
    });
  });
  it("describes upcoming and ended sprints", () => {
    expect(
      sprintRow(
        sprint({
          start: "2026-11-16T00:00:00Z",
          blocked: 0,
          changedInAdo: false,
        }),
        now,
      ),
    ).toMatchObject({ timing: "Starts in 4 days", flags: ["Not started"] });
    expect(
      sprintRow(sprint({ start: "2026-11-13T00:00:00Z" }), now).timing,
    ).toBe("Starts in 1 day");
    expect(sprintRow(sprint({ end: "2026-11-10T00:00:00Z" }), now).timing).toBe(
      "Ended",
    );
    expect(sprintRow(sprint({ end: "2026-11-13T00:00:00Z" }), now).timing).toBe(
      "1 day left",
    );
  });
  it("lists current and upcoming sprints, filtered by work area", () => {
    const sprints = [
      sprint({ id: "later", start: "2026-11-16T00:00:00Z" }),
      sprint({ id: "now" }),
      sprint({ id: "draft", draft: true }),
      sprint({ id: "old", end: "2026-11-01T00:00:00Z" }),
      sprint({ id: "other", workAreaId: "x" }),
    ];
    expect(sprintOverview(sprints, now).map((item) => item.id)).toEqual([
      "now",
      "other",
      "later",
    ]);
    expect(sprintOverview(sprints, now, "x").map((item) => item.id)).toEqual([
      "other",
    ]);
  });
  const plan: SprintPlan = {
    goal: "Goal",
    capacity: null,
    stories: [
      { id: "1", title: "A", points: 5, owner: "Mohammed" },
      { id: "2", title: "B", points: null, owner: null },
    ],
    out: [{ id: "3", title: "C", points: 3, owner: null }],
  };
  it("never invents capacity", () => {
    expect(planSummary(plan)).toMatchObject({
      load: 5,
      unsized: 1,
      capacity: { known: false, label: "Capacity not set · ask team" },
      feasible: null,
      footer: "Preview only · No Azure DevOps changes",
    });
  });
  it("reports load against known capacity and groups by owner", () => {
    const summary = planSummary({ ...plan, capacity: 4 });
    expect(summary.capacity).toEqual({
      known: true,
      ratio: 1.25,
      over: true,
      label: "5 of 4 points",
    });
    expect(summary.feasible).toBe(false);
    expect(summary.byOwner.map((group) => group.owner)).toEqual([
      "Mohammed",
      "Unassigned",
    ]);
    expect(planSummary({ ...plan, capacity: 0 }).capacity).toMatchObject({
      ratio: 0,
    });
    expect(planSummary({ ...plan, capacity: 10 }).feasible).toBe(true);
  });
  it("moves stories between the sprint, the out list and owners", () => {
    const out = moveStory(plan, "1", { list: "out" });
    expect(out.stories.map((story) => story.id)).toEqual(["2"]);
    expect(out.out.map((story) => story.id)).toEqual(["3", "1"]);
    const back = moveStory(plan, "3", { list: "stories", owner: "Sara" });
    expect(back.stories.at(-1)).toEqual({
      id: "3",
      title: "C",
      points: 3,
      owner: "Sara",
    });
    expect(back.out).toEqual([]);
    expect(moveStory(plan, "zz", { list: "out" })).toBe(plan);
  });
  it("summarises pull requests read-only", () => {
    const pull = (id: string, extra: object) => ({
      id,
      title: id,
      state: "open" as const,
      openedAt: "2026-11-01T00:00:00Z",
      mergedAt: null,
      reviewer: "R",
      ...extra,
    });
    const stats = pullStats(
      [
        pull("a", {}),
        pull("b", { openedAt: "2026-11-11T00:00:00Z", reviewer: null }),
        pull("c", { state: "merged", mergedAt: "2026-11-03T00:00:00Z" }),
        pull("d", { state: "merged", mergedAt: "2026-11-05T00:00:00Z" }),
      ],
      now,
    );
    expect(stats.text).toBe(
      "2 open · 1 waiting > 3 days · 1 without reviewer · median time to merge 3 days",
    );
    expect(pullStats([], now).text).toContain("no merges yet");
    expect(
      pullStats(
        [pull("c", { state: "merged", mergedAt: "2026-11-02T00:00:00Z" })],
        now,
      ).text,
    ).toContain("median time to merge 1 day");
  });
  it("shows calendar exceptions only when configured", () => {
    expect(calendarNote([])).toContain(
      "Holidays are not inferred from location",
    );
    expect(
      calendarNote([{ date: "2026-12-02", label: "National Day" }]),
    ).toBeNull();
  });
});

describe("Library and Decisions (rail)", () => {
  const entry = (extra: Partial<LibraryItem>): LibraryItem => ({
    id: "l",
    section: "output",
    type: "prd",
    title: "PRD",
    groupId: "employer",
    workAreaIds: ["w"],
    status: "Draft",
    needsLinking: false,
    updatedAt: "2026-11-10",
    ...extra,
  });
  const items = [
    entry({ id: "1" }),
    entry({
      id: "2",
      type: "interview",
      section: "record",
      workAreaIds: [],
      needsLinking: true,
      updatedAt: "2026-11-11",
    }),
    entry({ id: "3", groupId: "side", workAreaIds: ["x"] }),
    entry({ id: "4", groupId: null, workAreaIds: ["w", "y"], title: "Deck" }),
  ];
  const ids = (groups: { items: LibraryItem[] }[]) =>
    groups.map((group) => group.items.map((item) => item.id));
  it("opens scoped to the active work area and group", () => {
    expect(
      ids(library(items, { workAreaId: "w", groupIds: ["employer"] })),
    ).toEqual([["1", "4"]]);
  });
  it("browses all permitted without crossing groups", () => {
    expect(
      ids(library(items, { workAreaId: null, groupIds: ["employer"] })),
    ).toEqual([["2", "1", "4"]]);
    expect(
      ids(library(items, { workAreaId: null, groupIds: null }))[0],
    ).toHaveLength(4);
  });
  it("filters by type, needs linking and text", () => {
    const base = { workAreaId: null, groupIds: ["employer"] };
    expect(ids(library(items, { ...base, type: "interview" }))).toEqual([
      ["2"],
    ]);
    expect(ids(library(items, { ...base, needsLinking: true }))).toEqual([
      ["2"],
    ]);
    expect(ids(library(items, { ...base, text: "deck" }))).toEqual([["4"]]);
  });
  it("groups by type or by work area", () => {
    const base = { workAreaId: null, groupIds: ["employer"] };
    expect(
      library(items, { ...base, groupBy: "type" }).map((group) => group.key),
    ).toEqual(["interview", "prd"]);
    expect(
      library(items, { ...base, groupBy: "work" }).map((group) => group.key),
    ).toEqual(["w", "y", ""]);
  });
  it("splits Decisions into waiting and recorded, scoped to the work", () => {
    const decision = (extra: Partial<Decision>): Decision => ({
      id: "d",
      groupId: "employer",
      workAreaId: "w",
      what: "Add reporting",
      options: [],
      decidedBy: null,
      decidedAt: null,
      outcome: null,
      affected: [],
      source: "conversation",
      ...extra,
    });
    const log = decisionLog(
      [
        decision({ id: "wait" }),
        decision({
          id: "old",
          outcome: "Yes",
          decidedAt: "2026-11-01",
          decidedBy: "you",
        }),
        decision({
          id: "new",
          outcome: "No",
          decidedAt: "2026-11-09",
          decidedBy: "client",
        }),
        decision({ id: "other", workAreaId: "x" }),
        decision({ id: "side", groupId: "side" }),
      ],
      { workAreaId: "w", groupIds: ["employer"] },
    );
    expect(log.waiting.map((item) => item.id)).toEqual(["wait"]);
    expect(log.recorded.map((item) => item.id)).toEqual(["new", "old"]);
    expect(
      decisionLog([decision({ id: "side", groupId: "side" })], {
        workAreaId: null,
        groupIds: null,
      }).waiting,
    ).toHaveLength(1);
  });
});

describe("Agents org chart (Q36)", () => {
  const agent = (extra: Partial<AgentCard>): AgentCard => ({
    id: "a",
    role: "Researcher",
    kind: "always_on",
    launcherId: null,
    state: "idle",
    nowDoing: null,
    ...extra,
  });
  it("puts Firstmate on top, always-on agents below, temporary under their launcher", () => {
    const chart = orgChart([
      agent({
        id: "t",
        role: "Temp reader",
        kind: "temporary",
        launcherId: "r",
        state: "done",
      }),
      agent({ id: "r", role: "Researcher", state: "working" }),
      agent({ id: "f", role: "Firstmate", kind: "lead" }),
      agent({ id: "w", role: "Analyst", state: "waiting" }),
      agent({ id: "q", role: "Quick helper", kind: "temporary" }),
    ])!;
    expect(chart).toMatchObject({ id: "f", icon: "lead" });
    expect(chart.children.map((child) => child.id)).toEqual(["w", "r", "q"]);
    expect(chart.children[0]).toMatchObject({
      icon: "pin",
      status: "Waiting on you",
    });
    expect(chart.children[1]!.children[0]).toMatchObject({
      id: "t",
      icon: "timer",
      fading: true,
      status: "Finished",
    });
    expect(chart.children[1]!.status).toBe("Working");
    // The Agents screen lists the whole team, including the helper that sits
    // under the agent that started it.
    expect(teamUnder(chart).map((member) => member.id)).toEqual([
      "w",
      "r",
      "t",
      "q",
    ]);
  });
  it("needs a lead agent", () => {
    expect(orgChart([agent({})])).toBeNull();
  });
});
