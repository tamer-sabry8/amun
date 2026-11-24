import { describe, expect, it } from "vitest";
import type { WorkSnapshot } from "../../../packages/contracts/src/work.ts";
import { agentCatalog } from "../../../packages/domain/src/work/agents.ts";
import { typeName } from "../src/rebuild/rail.tsx";
import {
  amunProtocol,
  parseAmunActions,
  resolveLibraryOpen,
  resolveShowDocument,
} from "../src/rebuild/view-model.ts";

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
  priority: null,
  keptHere: [],
  firstChat: { title: null, archivedAt: null },
  ...extra,
});

const libItem = (
  id: string,
  extra: Partial<WorkSnapshot["library"][number]> = {},
): WorkSnapshot["library"][number] => ({
  id,
  section: "output",
  type: "prd",
  title: "Document " + id,
  groupId: "employer",
  workAreaIds: ["a1"],
  status: "Draft",
  needsLinking: false,
  body: "# Body",
  updatedAt: "2026-11-24T10:00:00Z",
  version: 1,
  approvedVersion: null,
  acceptance: null,
  origin: null,
  versions: [],
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
    routes: [],
    areas: [
      area("a1", { name: "Alpha", groupId: "employer" }),
      area("a2", { name: "Beta", groupId: "employer" }),
      area("side-1", { name: "Side", groupId: "side" }),
      area("free-1", { name: "General", groupId: null }),
      area("free-2", { name: "Other ungrouped", groupId: null }),
    ],
    relations: [],
    records: [],
    objectives: [],
    permissions: [],
    grants: [],
    rules: [],
    ruleCandidate: null,
    attention: [],
    plans: [],
    blockers: [],
    reminders: [],
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
    memory: { unsynced: 0, disputed: 0, facts: [] },
    messages: [],
    chats: [],
    requests: [],
    delivery: [],
    deliveryLinks: [],
    ...extra,
  };
}

describe("amun-canvas.md catalogue", () => {
  it("loads via ?raw, substitutes agentCatalog, and documents supported canvas shapes", () => {
    expect(amunProtocol).not.toContain("${agentCatalog}");
    for (const agent of agentCatalog) {
      expect(amunProtocol).toContain(`${agent.name} (`);
    }
    expect(amunProtocol).toContain('"do":"document","request":"..."');
    expect(amunProtocol).toContain('"outputId"');
    expect(amunProtocol).toContain('"expectedVersion"');
    expect(amunProtocol).toContain(
      '{"do":"show","view":"document","outputId":"<Amun-issued Library ID>"}',
    );
    expect(amunProtocol).toContain("activity|backlog");
    expect(amunProtocol).toContain(
      '{"do":"story-drafts","request":"...","objectiveId":"...","expectedVersion":N,"stories":[...]}',
    );
    // Built-in PM guidance remains intact.
    expect(amunProtocol).toContain('{"do":"draft-stories"}');
    expect(amunProtocol).toContain("Backlog comparison pending");
    expect(amunProtocol).toContain("Hand to delivery");
    expect(amunProtocol).toContain("unlinked reading note");
  });
});

describe("friendly PM type labels (P3-5)", () => {
  it("maps PM artifact types to plain friendly labels", () => {
    expect(typeName("proposal")).toBe("Proposal");
    expect(typeName("rice")).toBe("RICE");
    expect(typeName("moscow")).toBe("MoSCoW");
    expect(typeName("roadmap")).toBe("Roadmap");
    expect(typeName("gantt")).toBe("Plan");
    expect(typeName("brief")).toBe("Brief");
    expect(typeName("prd")).toBe("PRD");
    expect(typeName("unknown_kind")).toBe("unknown_kind");
  });
});

describe("canonical Library origin click (P3-1)", () => {
  it("opens the originating work area, chat, message focus, and split pane output", () => {
    const item = libItem("doc-1", {
      groupId: "employer",
      workAreaIds: ["a1"],
      origin: {
        workAreaId: "a2",
        chatId: "chat-9",
        messageId: "msg-42",
        requestRef: "req-1",
        version: 1,
      },
    });
    const snap = snapshot({ library: [item] });
    expect(resolveLibraryOpen(snap, item, "a1", "chat-1")).toEqual({
      kind: "open",
      areaId: "a2",
      chatId: "chat-9",
      pane: { kind: "output", id: "doc-1" },
      focus: { messageId: "msg-42", flash: true },
    });
  });

  it("supports origin pointing to main chat (chatId: null)", () => {
    const item = libItem("doc-main", {
      groupId: null,
      workAreaIds: ["free-1"],
      origin: {
        workAreaId: "free-1",
        chatId: null,
        messageId: "msg-1",
        requestRef: null,
        version: 1,
      },
    });
    const snap = snapshot({ library: [item] });
    expect(resolveLibraryOpen(snap, item, "a1", "chat-1")).toEqual({
      kind: "open",
      areaId: "free-1",
      chatId: null,
      pane: { kind: "output", id: "doc-main" },
      focus: { messageId: "msg-1", flash: true },
    });
  });

  it("falls back locally when origin work area was deleted", () => {
    const item = libItem("doc-deleted", {
      groupId: "employer",
      workAreaIds: ["a1"],
      origin: {
        workAreaId: "deleted-area",
        chatId: "chat-old",
        messageId: "msg-old",
        requestRef: null,
        version: 1,
      },
    });
    const snap = snapshot({ library: [item] });
    expect(resolveLibraryOpen(snap, item, "a2", "chat-2")).toEqual({
      kind: "open",
      areaId: "a2",
      chatId: "chat-2",
      pane: { kind: "output", id: "doc-deleted" },
      focus: null,
    });
  });

  it("falls back locally when origin crosses groups", () => {
    const item = libItem("doc-cross", {
      groupId: "employer",
      workAreaIds: ["a1"],
      origin: {
        workAreaId: "side-1",
        chatId: "chat-side",
        messageId: "msg-side",
        requestRef: null,
        version: 1,
      },
    });
    const snap = snapshot({ library: [item] });
    expect(resolveLibraryOpen(snap, item, null, null)).toEqual({
      kind: "open",
      areaId: "a1",
      chatId: null,
      pane: { kind: "output", id: "doc-cross" },
      focus: null,
    });
  });

  it("returns unlinked when origin is null and no area is available", () => {
    const item = libItem("doc-unlinked", { workAreaIds: [] });
    const snap = snapshot({ library: [item] });
    expect(resolveLibraryOpen(snap, item, null, null)).toEqual({
      kind: "unlinked",
    });
  });

  it("returns null for download items", () => {
    const item = libItem("dl-1", { type: "download", workAreaIds: [] });
    expect(resolveLibraryOpen(snapshot(), item, "a1", null)).toBeNull();
  });
});

describe("prompted show parsing & scoped document resolution (P3-2, P3-3, P3-4)", () => {
  it("parses show for backlog and document (by outputId and/or title)", () => {
    const reply = [
      "Opening those now.",
      "```amun",
      JSON.stringify({ do: "show", view: "backlog" }),
      "```",
      "```amun",
      JSON.stringify({ do: "show", view: "document", outputId: "doc-1" }),
      "```",
      "```amun",
      JSON.stringify({ do: "show", view: "document", title: "Q3 Roadmap" }),
      "```",
      "```amun",
      JSON.stringify({ do: "show", view: "document" }),
      "```",
    ].join("\n");
    expect(parseAmunActions(reply).actions).toEqual([
      { do: "show", view: "backlog", filter: "all" },
      { do: "show", view: "document", outputId: "doc-1", title: null },
      { do: "show", view: "document", outputId: null, title: "Q3 Roadmap" },
    ]);
  });

  it("resolves outputId strictly within group and ungrouped area scope", () => {
    const empDoc = libItem("emp-1", {
      groupId: "employer",
      workAreaIds: ["a2"],
      title: "Launch Plan",
    });
    const sideDoc = libItem("side-1-doc", {
      groupId: "side",
      workAreaIds: ["side-1"],
      title: "Side Plan",
    });
    const freeDoc1 = libItem("free-doc-1", {
      groupId: null,
      workAreaIds: ["free-1"],
      title: "Personal Brief",
    });
    const freeDoc2 = libItem("free-doc-2", {
      groupId: null,
      workAreaIds: ["free-2"],
      title: "Other Brief",
    });
    const recordDoc = libItem("rec-1", {
      section: "record",
      groupId: "employer",
      workAreaIds: ["a1"],
      title: "Interview Notes",
    });
    const snap = snapshot({
      library: [empDoc, sideDoc, freeDoc1, freeDoc2, recordDoc],
    });

    // Same group outputId succeeds even from sibling area
    expect(
      resolveShowDocument(snap, {
        areaId: "a1",
        groupId: "employer",
        outputId: "emp-1",
        title: null,
      }),
    ).toEqual({ kind: "found", item: empDoc });

    // Cross-group outputId is rejected (never falls back to title)
    expect(
      resolveShowDocument(snap, {
        areaId: "a1",
        groupId: "employer",
        outputId: "side-1-doc",
        title: "Launch Plan",
      }),
    ).toEqual({ kind: "missing" });

    // Ungrouped outputId matches only when linked to areaId
    expect(
      resolveShowDocument(snap, {
        areaId: "free-1",
        groupId: null,
        outputId: "free-doc-1",
        title: null,
      }),
    ).toEqual({ kind: "found", item: freeDoc1 });
    expect(
      resolveShowDocument(snap, {
        areaId: "free-1",
        groupId: null,
        outputId: "free-doc-2",
        title: null,
      }),
    ).toEqual({ kind: "missing" });

    // Record section is excluded
    expect(
      resolveShowDocument(snap, {
        areaId: "a1",
        groupId: "employer",
        outputId: "rec-1",
        title: null,
      }),
    ).toEqual({ kind: "missing" });
  });

  it("resolves title with area-first precedence, group fallback, and strict ambiguity", () => {
    const a1Roadmap = libItem("r1", {
      groupId: "employer",
      workAreaIds: ["a1"],
      type: "roadmap",
      title: "Q3 Roadmap",
    });
    const a2Roadmap = libItem("r2", {
      groupId: "employer",
      workAreaIds: ["a2"],
      type: "roadmap",
      title: "Q3 Roadmap",
    });
    const a1Dup1 = libItem("d1", {
      groupId: "employer",
      workAreaIds: ["a1"],
      type: "brief",
      title: "Executive Brief",
    });
    const a1Dup2 = libItem("d2", {
      groupId: "employer",
      workAreaIds: ["a1"],
      type: "proposal",
      title: "Executive Brief",
    });
    const a2Only = libItem("b1", {
      groupId: "employer",
      workAreaIds: ["a2"],
      type: "rice",
      title: "RICE Scoring",
    });
    const freeOther = libItem("f2", {
      groupId: null,
      workAreaIds: ["free-2"],
      type: "brief",
      title: "Ungrouped Note",
    });
    const sideOnly = libItem("s1", {
      groupId: "side",
      workAreaIds: ["side-1"],
      type: "proposal",
      title: "Side Proposal",
    });
    const snap = snapshot({
      library: [
        a1Roadmap,
        a2Roadmap,
        a1Dup1,
        a1Dup2,
        a2Only,
        freeOther,
        sideOnly,
      ],
    });

    // 1 match in active area wins over duplicate in sibling area (case/trim normalized)
    expect(
      resolveShowDocument(snap, {
        areaId: "a1",
        groupId: "employer",
        outputId: null,
        title: "  q3 roadmap ",
      }),
    ).toEqual({ kind: "found", item: a1Roadmap });

    // >1 match in active area returns ambiguous, never guesses newest
    expect(
      resolveShowDocument(snap, {
        areaId: "a1",
        groupId: "employer",
        outputId: null,
        title: "executive brief",
      }),
    ).toEqual({ kind: "ambiguous", items: [a1Dup1, a1Dup2] });

    // 0 in active area, 1 in same group returns found
    expect(
      resolveShowDocument(snap, {
        areaId: "a1",
        groupId: "employer",
        outputId: null,
        title: "RICE Scoring",
      }),
    ).toEqual({ kind: "found", item: a2Only });

    // 0 in active area, >1 in same group returns ambiguous
    expect(
      resolveShowDocument(snap, {
        areaId: "a2",
        groupId: "employer",
        outputId: null,
        title: "Executive Brief",
      }),
    ).toEqual({ kind: "ambiguous", items: [a1Dup1, a1Dup2] });

    // Ungrouped (groupId === null) never matches outside areaId
    expect(
      resolveShowDocument(snap, {
        areaId: "free-1",
        groupId: null,
        outputId: null,
        title: "Ungrouped Note",
      }),
    ).toEqual({ kind: "missing" });

    // Cross-group title never matches
    expect(
      resolveShowDocument(snap, {
        areaId: "a1",
        groupId: "employer",
        outputId: null,
        title: "Side Proposal",
      }),
    ).toEqual({ kind: "missing" });
  });
});
