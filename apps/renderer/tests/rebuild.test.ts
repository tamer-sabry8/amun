import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkSnapshot } from "../../../packages/contracts/src/work.ts";
import { leaksRuntimeVocabulary } from "../../../packages/domain/src/work/shell.ts";
import { Island, Sidebar } from "../src/rebuild/chrome.tsx";
import { Home, IntakeCard } from "../src/rebuild/home.tsx";
import { DecisionsPanel, LibraryPanel, Rail } from "../src/rebuild/rail.tsx";
import { Portfolio, Rfps, Roadmap, Sprints } from "../src/rebuild/screens.tsx";
import { receive, workStore } from "../src/rebuild/store.ts";
import {
  attentionItems,
  homeModel,
  parseAmunActions,
  replyFromTranscript,
  trayFor,
  visibleGroups,
  workContext,
} from "../src/rebuild/view-model.ts";

const now = Date.parse("2026-11-12T08:00:00Z");
const area = (
  id: string,
  extra: Partial<WorkSnapshot["areas"][number]> = {},
): WorkSnapshot["areas"][number] => ({
  id,
  groupId: "employer",
  type: "product",
  name: "Area " + id,
  purpose: "",
  status: "active",
  productId: null,
  stakeholder: 0,
  client: null,
  clientWeight: 0,
  dueAt: null,
  effort: null,
  milestones: 0,
  people: 0,
  steps: 0,
  declinedShape: null,
  convertedFrom: null,
  lastContextAt: "2026-11-11T08:00:00Z",
  interest: 0,
  createdAt: "2026-11-01T08:00:00Z",
  ...extra,
});
const attention = (
  id: string,
  extra: Partial<WorkSnapshot["attention"][number]> = {},
): WorkSnapshot["attention"][number] => ({
  id,
  kind: "approval",
  groupId: "employer",
  workAreaId: "ticao",
  title: "6 stories ready for Azure DevOps",
  detail: "Sprint 14 · Proposed changes await your approval",
  state: "open",
  ref: null,
  options: [],
  answer: null,
  createdAt: "2026-11-12T07:00:00Z",
  ...extra,
});
function snapshot(extra: Partial<WorkSnapshot> = {}): WorkSnapshot {
  return {
    version: 1,
    kind: "work-snapshot",
    setup: {
      completed: true,
      step: "models",
      workTypes: [],
      tools: [],
      theme: "system",
      lastSeenAt: "2026-11-11T00:00:00Z",
      activeGroupId: "employer",
      libraryView: "gallery",
      libraryGroupBy: "work",
    },
    groups: [
      { id: "employer", name: "Employer", position: 0 },
      { id: "side", name: "Side business", position: 1 },
    ],
    routes: [{ id: "r", groupId: "employer", condition: null, tracker: "ado" }],
    areas: [],
    relations: [],
    records: [],
    objectives: [],
    permissions: [],
    grants: [],
    rules: [],
    ruleCandidate: null,
    attention: [],
    plans: [],
    rfps: [],
    roadmap: [],
    sprints: [],
    calendar: [],
    library: [],
    decisions: [],
    agents: [],
    activity: [],
    council: [],
    findings: [],
    memory: { unsynced: 0, disputed: 0 },
    messages: [],
    ...extra,
  };
}
const plan = (
  extra: Partial<WorkSnapshot["plans"][number]> = {},
): WorkSnapshot["plans"][number] => ({
  id: "p1",
  groupId: "employer",
  workAreaId: "ticao",
  kind: "stories",
  destination: "ado",
  summary: "6 new stories → Sprint 14",
  items: Array.from({ length: 6 }, (_, index) => ({
    id: "s" + index,
    summary: "Story " + index,
    fields: {},
  })),
  fingerprint: "fp",
  state: "proposed",
  results: [],
  createdAt: "2026-11-12T07:00:00Z",
  ...extra,
});
const active = () =>
  snapshot({
    areas: [
      area("ticao", { name: "TICAO" }),
      area("side-work", { groupId: "side", name: "Supplier research" }),
    ],
    attention: [
      attention("a1", { ref: "plan:p1" }),
      attention("a2", {
        kind: "question",
        title: "Which metric?",
        options: ["People", "Hours"],
      }),
      attention("a3", {
        kind: "result",
        groupId: "side",
        workAreaId: "side-work",
        title: "Supplier list",
      }),
    ],
    plans: [plan()],
  });
const noop = () => undefined;
const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("view model", () => {
  it("shows only the active group's items", () => {
    const view = homeModel(active(), now);
    expect(view.rows.map((row) => row.id)).toEqual(["a1", "a2"]);
    expect(view.work.map((entry) => entry.area.id)).toEqual(["ticao"]);
    expect(visibleGroups(active())).toEqual(["employer"]);
  });
  it("shows everything when no group is chosen yet", () => {
    const all = active();
    all.setup.activeGroupId = null;
    expect(homeModel(all, now).rows).toHaveLength(3);
    expect(visibleGroups(all)).toBeNull();
  });
  it("offers the tray only for a proposed batch and binds it to the plan", () => {
    expect(attentionItems(active())[0]!.batch).toMatchObject({
      count: 6,
      noun: "story",
    });
    expect(trayFor(active(), "a1")).toMatchObject({
      approve: "Approve and publish 6 stories",
      showAll: "Show all 6 items",
      plan: { fingerprint: "fp" },
    });
    expect(trayFor(active(), "a2")).toBeNull();
    const approved = active();
    approved.plans[0]!.state = "approved";
    expect(trayFor(approved, "a1")).toBeNull();
    expect(attentionItems(approved)[0]!.batch).toBeUndefined();
  });
  it("is the Welcome screen until there is work or something waiting", () => {
    expect(homeModel(snapshot(), now).welcome).toBe(true);
    expect(homeModel(active(), now).welcome).toBe(false);
  });
  it("summarises what arrived while away and the Island's top item", () => {
    const view = homeModel(active(), now);
    expect(view.away?.text).toBe("While you were away: 1 approval, 1 question");
    expect(view.island).toMatchObject({ top: { id: "a1" }, count: 2 });
  });
  it("builds a work area's context: objective, conversion, RFP, failure", () => {
    const state = snapshot({
      areas: [
        area("task", { type: "task", milestones: 3, people: 4 }),
        area("rfp", { type: "rfp" }),
      ],
      objectives: [
        {
          id: "o",
          groupId: "employer",
          metric: "% billable",
          baseline: 60,
          target: 90,
          current: 75,
          evidenceDate: null,
          reviewDate: null,
          conflict: false,
          links: ["task"],
        },
      ],
      rfps: [
        {
          id: "rfp",
          client: "DMT",
          stage: "in_response",
          deadline: "2026-11-17T08:00:00Z",
          responseOwner: null,
          accountOwner: null,
          presales: null,
          proposalSigned: false,
          brdApproved: false,
          deliveryProjectId: null,
          lossReason: null,
        },
      ],
      attention: [
        attention("f", {
          kind: "failure",
          workAreaId: "task",
          title: "Some approved changes were not published",
        }),
      ],
    });
    const task = workContext(state, "task", now)!;
    expect(task.objective?.progress).toMatchObject({ state: "tracking" });
    expect(task.conversion?.text).toBe(
      "3 milestones and 4 people. Make it a project?",
    );
    expect(task.failure?.id).toBe("f");
    expect(workContext(state, "rfp", now)!.rfp?.card).toMatchObject({
      countdown: "Due in 5 days",
      missingOwner: true,
    });
    expect(workContext(state, "missing", now)).toBeNull();
  });
  it("extracts Firstmate's reply from the conversation", () => {
    const before = "You: hello\nAssistant: hi\n";
    expect(
      replyFromTranscript(
        before,
        before + "You: plan it\nAssistant:\nHere is the plan.\n",
        "plan it",
      ),
    ).toBe("Here is the plan.");
    expect(replyFromTranscript(before, before, "plan it")).toBeNull();
    expect(replyFromTranscript("", "Just an answer", "")).toBe(
      "Just an answer",
    );
  });
});

describe("store", () => {
  beforeEach(() => workStore.reset());
  it("keeps the latest snapshot, results and Council status", () => {
    const results: string[] = [];
    const stop = workStore.onResult((result) => results.push(result.action));
    expect(receive({ nonsense: true })).toBe(false);
    expect(receive(snapshot())).toBe(true);
    receive({
      version: 1,
      kind: "work-result",
      action: "intake",
      ok: true,
      message: "",
      ref: "x",
      step: { step: "ask_group" },
    });
    receive({
      version: 1,
      kind: "council-status",
      installed: false,
      commit: null,
      previous: null,
      repo: null,
      claude: true,
      seats: [],
      roomUrl: null,
      message: "",
    });
    stop();
    expect(workStore.getSnapshot()).toMatchObject({
      snapshot: { kind: "work-snapshot" },
      result: { action: "intake", ref: "x" },
      council: { installed: false, claude: true },
    });
    expect(results).toEqual(["intake"]);
    workStore.clearResult();
    expect(workStore.getSnapshot().result).toBeNull();
  });
});

describe("shell chrome", () => {
  it("renders Home, Search, the six tiles and Settings, in order", () => {
    const html = renderToStaticMarkup(
      createElement(Sidebar, {
        route: "roadmap",
        collapsed: false,
        onRoute: noop,
        onSearch: noop,
        onToggle: noop,
        island: null,
      }),
    );
    expect(
      [...html.matchAll(/<span>([^<]+)<\/span>/g)].map((match) => match[1]),
    ).toEqual([
      "Home",
      "Search",
      "Agents",
      "Council",
      "Roadmap",
      "Sprints",
      "Portfolio",
      "RFPs",
    ]);
    expect(html).toMatch(/aria-current="page"[^>]*>.*?Roadmap/);
    expect(html).not.toMatch(/Requests|Terminal|Priorities|Crew/);
  });
  it("names the collapsed strip's icons for assistive technology", () => {
    const html = renderToStaticMarkup(
      createElement(Sidebar, {
        route: "home",
        collapsed: true,
        onRoute: noop,
        onSearch: noop,
        onToggle: noop,
        island: null,
      }),
    );
    expect(html).toContain('aria-label="Sprints"');
    expect(html).toContain('aria-label="Expand sidebar"');
  });
  it("shows the Island's single most urgent item with its key button and count", () => {
    const view = homeModel(active(), now);
    const html = text(
      renderToStaticMarkup(
        createElement(Island, {
          top: view.island.top,
          count: view.island.count,
          options: [],
          collapsed: false,
          actions: { onOpen: noop, onPrimary: noop, onAnswer: noop },
        }),
      ),
    );
    expect(html).toContain("Needs your approval");
    expect(html).toContain("6 stories ready for Azure DevOps");
    expect(html).toContain("Review changes");
    expect(html).toContain(" 2 ");
  });
  it("offers answers and 'Write my own response' for a question", () => {
    const question = attentionItems(active())[1]!;
    const html = text(
      renderToStaticMarkup(
        createElement(Island, {
          top: question,
          count: 1,
          options: ["People", "Hours"],
          collapsed: false,
          actions: { onOpen: noop, onPrimary: noop, onAnswer: noop },
        }),
      ),
    );
    expect(html).toContain("People");
    expect(html).toContain("Hours");
    expect(html).toContain("Write my own response");
  });
  it("becomes icon and badge in the collapsed sidebar, and says so when empty", () => {
    const view = homeModel(active(), now);
    const collapsed = renderToStaticMarkup(
      createElement(Island, {
        top: view.island.top,
        count: 2,
        options: [],
        collapsed: true,
        actions: { onOpen: noop, onPrimary: noop, onAnswer: noop },
      }),
    );
    expect(collapsed).toContain('aria-label="2 items need you"');
    expect(collapsed).not.toContain("Review changes");
    const empty = renderToStaticMarkup(
      createElement(Island, {
        top: null,
        count: 0,
        options: [],
        collapsed: false,
        actions: { onOpen: noop, onPrimary: noop, onAnswer: noop },
      }),
    );
    expect(empty).toContain("Nothing needs you right now.");
  });
  it("keeps the rail to Activity, Downloads, Library and Decisions with counts in the names", () => {
    const html = renderToStaticMarkup(
      createElement(Rail, {
        open: "library",
        running: 2,
        waiting: 1,
        downloads: 0,
        onOpen: noop,
      }),
    );
    expect(
      [...html.matchAll(/aria-label="([^"]+)" aria-expanded/g)].map(
        (match) => match[1],
      ),
    ).toEqual([
      "Activity drawer, 2 active",
      "Downloads drawer",
      "Library drawer",
      "Decisions drawer, 1 waiting on you",
    ]);
    expect(html).toMatch(/aria-label="Library drawer" aria-expanded="true"/);
  });
});

describe("Home", () => {
  const props = {
    now,
    model: "claude-sonnet-5-5",
    pending: null,
    note: "",
    connected: [] as string[],
    onSend: noop,
    onResubmit: noop,
    onOpen: noop,
    onPortfolio: noop,
    onPendingDone: noop,
    onNote: noop,
  };
  it("welcomes first use with four starting cards and the composer", () => {
    const html = text(
      renderToStaticMarkup(
        createElement(Home, { ...props, snapshot: snapshot() }),
      ),
    );
    for (const card of [
      "Welcome to Amun",
      "Create a product",
      "Turn an idea into a brief",
      "Track an RFP",
      "Start a task",
    ])
      expect(html).toContain(card);
    expect(html).not.toContain("Respond to an RFP");
    expect(html).toContain("Auto · claude-sonnet-5-5");
  });
  it("lists attention with at most one primary button per row, then Your work", () => {
    const html = renderToStaticMarkup(
      createElement(Home, { ...props, snapshot: active() }),
    );
    const plain = text(html);
    expect(plain).toContain("Thursday 12 November");
    expect(plain).toContain("While you were away: 1 approval, 1 question");
    expect(plain).toContain("Approval · Employer / TICAO");
    expect(plain).toContain("Your work");
    expect(plain).toContain("View all");
    const rows = html.split('class="rb-att"').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.match(/class="btn"/g)).toHaveLength(1);
    expect(rows[0]).toContain("Review changes");
    // A question row has no button of its own: opening it is the action.
    expect(rows[1]!.match(/class="btn"/g)).toBeNull();
    // Another group's work never appears alongside.
    expect(plain).not.toContain("Supplier");
  });
  it("asks one question at a time during intake", () => {
    const base = {
      snapshot: active(),
      connected: ["ado"],
      onResubmit: noop,
      onOpen: noop,
      onDone: noop,
    };
    const card = (pending: Parameters<typeof IntakeCard>[0]["pending"]) =>
      text(
        renderToStaticMarkup(createElement(IntakeCard, { ...base, pending })),
      );
    const group = card({ step: "ask_group", text: "x", files: [] });
    expect(group).toContain("Which group is this for?");
    expect(group).toContain("Employer");
    const record = card({
      step: "save_record",
      type: "interview",
      recordId: "r",
      groupId: "employer",
      text: "x",
      files: [],
    });
    expect(record).toContain("Saved as an interview. Where does it belong?");
    expect(record).toContain("Link later");
    expect(record).toContain("Leave unlinked");
    expect(record).toContain("TICAO");
    expect(record).not.toContain("Supplier research");
    const choose = card({
      step: "choose_work",
      type: "rfp",
      title: "DMT",
      groupId: "employer",
      options: [],
      text: "x",
      files: [],
    });
    expect(choose).toContain("New RFP");
    const ticket = card({
      step: "route_execution",
      title: "Fix login",
      groupId: "employer",
      text: "x",
      files: [],
    });
    expect(ticket).toContain("It belongs in Azure DevOps.");
    expect(ticket).toContain(
      "Writing to Azure DevOps always needs your approval.",
    );
    expect(ticket).toContain("Propose it for review");
  });
});

describe("rail panels", () => {
  const library: WorkSnapshot["library"] = [
    {
      id: "o1",
      section: "output",
      type: "prd",
      title: "TICAO PRD",
      groupId: "employer",
      workAreaIds: ["ticao"],
      status: "Draft",
      needsLinking: false,
      body: "",
      updatedAt: "2026-11-10",
    },
    {
      id: "r1",
      section: "record",
      type: "interview",
      title: "Onboarding call",
      groupId: "employer",
      workAreaIds: [],
      status: "Needs linking",
      needsLinking: true,
      body: "",
      updatedAt: "2026-11-11",
    },
    {
      id: "x1",
      section: "output",
      type: "deck",
      title: "Side deck",
      groupId: "side",
      workAreaIds: ["side-work"],
      status: "Draft",
      needsLinking: false,
      body: "",
      updatedAt: "2026-11-11",
    },
  ];
  it("opens the Library scoped to the active work, inside the group", () => {
    const state = { ...active(), library };
    const scoped = text(
      renderToStaticMarkup(
        createElement(LibraryPanel, {
          snapshot: state,
          workAreaId: "ticao",
          onOpen: noop,
          onWork: noop,
        }),
      ),
    );
    expect(scoped).toContain("TICAO PRD");
    expect(scoped).not.toContain("Onboarding call");
    expect(scoped).toContain("Browse all permitted");
    const all = text(
      renderToStaticMarkup(
        createElement(LibraryPanel, {
          snapshot: state,
          workAreaId: null,
          onOpen: noop,
          onWork: noop,
        }),
      ),
    );
    expect(all).toContain("Onboarding call");
    expect(all).toContain("Needs linking");
    expect(all).not.toContain("Side deck");
  });
  it("separates decisions waiting on you from the log", () => {
    const state = snapshot({
      areas: [area("ticao", { name: "TICAO" })],
      decisions: [
        {
          id: "d1",
          groupId: "employer",
          workAreaId: "ticao",
          what: "Raise prices",
          options: ["Raise by 10%"],
          decidedBy: null,
          decidedAt: null,
          outcome: null,
          affected: [],
          source: "council",
        },
        {
          id: "d2",
          groupId: "employer",
          workAreaId: "ticao",
          what: "Add reporting",
          options: [],
          decidedBy: "you",
          decidedAt: "2026-11-09T00:00:00Z",
          outcome: "Added as an exception",
          affected: ["Reporting"],
          source: "exception",
        },
      ],
    });
    const html = text(
      renderToStaticMarkup(
        createElement(DecisionsPanel, {
          snapshot: state,
          workAreaId: "ticao",
          onReview: noop,
        }),
      ),
    );
    expect(html).toMatch(/Waiting on you.*Raise prices.*Council.*Review/);
    expect(html).toMatch(/Decision log.*Add reporting.*You · 9 Nov.*Exception/);
  });
});

describe("destinations", () => {
  it("Portfolio lists the active group's work only", () => {
    const html = text(
      renderToStaticMarkup(
        createElement(Portfolio, { snapshot: active(), onWork: noop }),
      ),
    );
    expect(html).toContain("TICAO");
    expect(html).not.toContain("Supplier research");
  });
  it("RFPs is a tracking pipeline with the proposed stages", () => {
    const state = snapshot({
      areas: [area("rfp", { type: "rfp", name: "Smart Inspection" })],
      rfps: [
        {
          id: "rfp",
          client: "DMT",
          stage: "received",
          deadline: "2026-11-17T08:00:00Z",
          responseOwner: null,
          accountOwner: null,
          presales: null,
          proposalSigned: false,
          brdApproved: false,
          deliveryProjectId: null,
          lossReason: null,
        },
      ],
    });
    const html = text(
      renderToStaticMarkup(
        createElement(Rfps, {
          snapshot: state,
          now,
          model: null,
          onWork: noop,
        }),
      ),
    );
    for (const stage of [
      "Received",
      "In response",
      "Submitted",
      "Won",
      "Handed to delivery",
      "Lost and withdrawn (0)",
    ])
      expect(html).toContain(stage);
    expect(html).toContain("Due in 5 days");
    expect(html).toContain("No response owner");
    expect(html).toContain(
      "Writing the response belongs to a separate product",
    );
  });
  it("Sprints shows progress, flags and the preview footer", () => {
    const state = snapshot({
      areas: [area("ticao", { name: "TICAO" })],
      sprints: [
        {
          id: "s",
          workAreaId: "ticao",
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
          capacity: null,
          stories: [],
          out: [],
        },
      ],
    });
    const html = text(
      renderToStaticMarkup(
        createElement(Sprints, {
          snapshot: state,
          now,
          model: null,
          onWork: noop,
          onReview: noop,
        }),
      ),
    );
    expect(html).toContain("Employer · Azure DevOps");
    expect(html).toContain("TICAO · Sprint 14");
    expect(html).toContain("6 / 12 stories done");
    expect(html).toContain("1 blocked");
    expect(html).toContain("Changed in ADO");
    expect(html).toContain("Preview only · No Azure DevOps changes");
  });
  it("Roadmap shows Now / Next / Later with RICE badges and commitment", () => {
    const item = {
      workAreaId: "ticao",
      position: 0,
      release: null,
      start: null,
      end: null,
      reach: null,
      impact: null,
      confidence: null,
      effort: null,
    };
    const state = snapshot({
      areas: [area("ticao", { name: "TICAO" })],
      roadmap: [
        {
          ...item,
          id: "1",
          title: "Bulk upload",
          horizon: "now",
          committed: true,
          estimated: true,
          reach: 100,
          impact: 2,
          confidence: 50,
          effort: 2,
        },
        {
          ...item,
          id: "2",
          title: "Audit log",
          horizon: "later",
          committed: false,
          estimated: false,
        },
      ],
    });
    const html = text(
      renderToStaticMarkup(
        createElement(Roadmap, {
          snapshot: state,
          model: null,
          onReview: noop,
        }),
      ),
    );
    expect(html).toMatch(
      /Now 1 Bulk upload TICAO RICE 50 · estimated Committed/,
    );
    expect(html).toMatch(/Later 1 Audit log TICAO Commit…/);
  });
});

describe("plain language", () => {
  it("keeps runtime vocabulary out of the primary screens", () => {
    const state = active();
    const screens = [
      createElement(Home, {
        snapshot: state,
        now,
        model: null,
        pending: null,
        note: "",
        connected: [],
        onSend: noop,
        onResubmit: noop,
        onOpen: noop,
        onPortfolio: noop,
        onPendingDone: noop,
        onNote: noop,
      }),
      createElement(Portfolio, { snapshot: state, onWork: noop }),
      createElement(Rfps, { snapshot: state, now, model: null, onWork: noop }),
      createElement(Roadmap, { snapshot: state, model: null, onReview: noop }),
      createElement(Sprints, {
        snapshot: state,
        now,
        model: null,
        onWork: noop,
        onReview: noop,
      }),
    ];
    for (const screen of screens)
      expect(
        leaksRuntimeVocabulary(text(renderToStaticMarkup(screen))),
      ).toBeNull();
  });
});

describe("Firstmate proposals", () => {
  const block = (value: unknown) =>
    "```amun\n" + JSON.stringify(value) + "\n```";
  it("separates what the user reads from what Firstmate proposed", () => {
    const reply = [
      "Here is the brief.",
      block({
        do: "document",
        title: "Platform PRD",
        type: "prd",
        body: "# PRD",
      }),
      block({
        do: "plan",
        planKind: "stories",
        destination: "ado",
        summary: "2 stories for Sprint 14",
        items: [
          {
            summary: "Invite tokens",
            fields: { sprint: "14", points: 3, nested: { no: 1 } },
          },
          { summary: "" },
          { summary: "Audit log" },
        ],
      }),
      block({
        do: "question",
        title: "Which metric?",
        options: ["People", "Hours", 7],
      }),
      block({ do: "scope", item: "Reporting", brd: "BRD v2" }),
      block({ do: "update", message: "Short update." }),
      block({
        do: "rule-case",
        situation: "sheet-vs-project",
        resolution: "use the sheet",
      }),
      block({ do: "offer", title: "Draft a follow-up?" }),
    ].join("\n\n");
    const parsed = parseAmunActions(reply);
    expect(parsed.text).toBe("Here is the brief.");
    expect(parsed.actions.map((action) => action.do)).toEqual([
      "document",
      "plan",
      "question",
      "scope",
      "update",
      "rule-case",
      "offer",
    ]);
    expect(parsed.actions[1]).toMatchObject({
      summary: "2 stories for Sprint 14",
      items: [
        { summary: "Invite tokens", fields: { sprint: "14", points: 3 } },
        { summary: "Audit log", fields: {} },
      ],
    });
    expect(parsed.actions[2]).toMatchObject({ options: ["People", "Hours"] });
  });
  it("drops anything malformed or unknown instead of showing raw data", () => {
    const parsed = parseAmunActions(
      [
        "Plain answer.",
        "```amun\n{ broken\n```",
        block({ do: "delete-everything" }),
        block({ do: "plan", summary: "Empty", items: [] }),
        block({ do: "document", body: "no title" }),
        block("just a string"),
        "```js\nconsole.log(1)\n```",
      ].join("\n\n"),
    );
    expect(parsed.actions).toEqual([]);
    expect(parsed.text).toBe("Plain answer.\n\n```js\nconsole.log(1)\n```");
  });
  it("never lets the model pick ids or act outside a proposal", () => {
    const parsed = parseAmunActions(
      block({
        do: "plan",
        id: "plan-123",
        workAreaId: "someone-elses",
        state: "approved",
        summary: "Sneaky",
        items: [{ id: "x", summary: "Item" }],
      }),
    );
    expect(parsed.actions).toEqual([
      {
        do: "plan",
        planKind: "stories",
        destination: "amun",
        summary: "Sneaky",
        items: [{ summary: "Item", fields: {} }],
      },
    ]);
  });
});
