import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => [] as unknown[][]);
vi.mock("../src/rebuild/store.ts", () => ({
  work: (...args: unknown[]) => sent.push(args),
}));

import {
  answerQuestion,
  answerScope,
  requestPlanChanges,
} from "../src/rebuild/accept-offer.ts";
import { offerTurns } from "../src/rebuild/offer-turns.ts";
import {
  amunProtocol,
  delegationTask,
  requestedLength,
  workTypeGuard,
} from "../src/rebuild/view-model.ts";

const queue = () => offerTurns(null);
beforeEach(() => void (sent.length = 0));

describe("Firstmate hears the owner's choices", () => {
  it("tells Firstmate once when changes are requested on a plan", () => {
    const q = queue();
    const plan = { id: "p1", workAreaId: "w1", summary: "Add 3 stories" };
    requestPlanChanges(plan, "Fewer items", q);
    requestPlanChanges(plan, "Fewer items", q);
    expect(sent[0]).toEqual([
      "request-changes",
      { planId: "p1", note: "Fewer items", told: true },
    ]);
    const turns = q.claim("w1").send;
    expect(turns).toHaveLength(1);
    expect(turns[0]!.text).toContain('"Add 3 stories"');
    expect(turns[0]!.text).toContain("Fewer items");
    expect(turns[0]!.text).toContain("revised proposal");
  });
  it("still closes a plan that belongs to no work, with nothing to send", () => {
    const q = queue();
    requestPlanChanges({ id: "p2", workAreaId: null, summary: "S" }, "", q);
    expect(sent).toHaveLength(1);
    expect(q.pending("w1")).toEqual([]);
  });
  it("sends the chosen answer on a question card to Firstmate once", () => {
    const q = queue();
    const card = { id: "a1", workAreaId: "w1", title: "Add the story?" };
    answerQuestion(card, "Add it and accept the risk to the deadline", q);
    answerQuestion(card, "Add it and accept the risk to the deadline", q);
    expect(sent[0]).toEqual([
      "resolve-attention",
      {
        attentionId: "a1",
        resolution: "answer",
        answer: "Add it and accept the risk to the deadline",
        told: true,
      },
    ]);
    const turns = q.claim("w1").send;
    expect(turns).toHaveLength(1);
    expect(turns[0]!.text).toContain("accept the risk to the deadline");
    expect(turns[0]!.text).toContain("Add the story?");
  });
  it.each([
    ["add_anyway", "not as approval from the client", "revised local draft"],
    ["link_cr", "change request reference", "Nothing is added"],
    ["keep_out", "keep it out of scope", "change nothing"],
  ] as const)(
    "tells Firstmate once about the scope choice %s",
    (answer, a, b) => {
      const q = queue();
      const scope = { areaId: "w1", item: "Export to PDF", answer };
      answerScope(scope, q);
      answerScope(scope, q);
      expect(sent[0]).toEqual([
        "scope-answer",
        { workAreaId: "w1", item: "Export to PDF", answer, told: true },
      ]);
      const turns = q.claim("w1").send;
      expect(turns).toHaveLength(1);
      expect(turns[0]!.text).toContain('"Export to PDF"');
      expect(turns[0]!.text).toContain(a);
      expect(turns[0]!.text).toContain(b);
      expect(turns[0]!.text).not.toMatch(/client (has )?approved/i);
    },
  );
  it("answers on a card with no work area close it and send nothing", () => {
    const q = queue();
    answerQuestion({ id: "a2", workAreaId: null, title: "T" }, "Yes", q);
    expect(sent).toHaveLength(1);
    expect(q.pending("")).toEqual([]);
  });
});

describe("requested length reaches the delegation brief", () => {
  it("finds a stated length", () => {
    expect(requestedLength("Draft a brief, 1-2 pages please")).toBe(
      "1-2 pages",
    );
    expect(requestedLength("an update under 90 words")).toBe("under 90 words");
    expect(requestedLength("a one-pager")).toBe("one-pager");
    expect(requestedLength("write a PRD")).toBeNull();
  });
  it("adds a length line unless the brief already states it", () => {
    expect(delegationTask("Write the PRD", "keep it under 90 words")).toContain(
      "Length the owner asked for: under 90 words",
    );
    expect(delegationTask("Write it, under 90 words", "under 90 words")).toBe(
      "Write it, under 90 words",
    );
    expect(delegationTask("Write the PRD", "write a PRD")).toBe(
      "Write the PRD",
    );
  });
});

describe("Firstmate's instructions", () => {
  it("covers hand-off, unlinked reading, other groups, length and sources", () => {
    expect(amunProtocol).toContain("Hand to delivery");
    expect(amunProtocol).toContain(
      "Do not convert it or create a delivery project yourself",
    );
    expect(amunProtocol).toContain("unlinked reading note");
    expect(amunProtocol).toContain("exactly the title they gave");
    expect(amunProtocol).toContain("always offer to ask for their approval");
    expect(amunProtocol).toContain("say it in the delegate task");
    expect(amunProtocol).toContain("square brackets");
  });
  it("puts the hand-off prerequisites in the RFP record", () => {
    const record = {
      client: "C",
      deadline: null,
      responseOwner: null,
      stage: "won",
      proposalSigned: true,
      brdApproved: false,
    };
    const text = workTypeGuard("rfp", record);
    expect(text).toContain("Proposal signed yes");
    expect(text).toContain("BRD approved no");
  });
});
