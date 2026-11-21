import { plannedLoad } from "../src/rebuild/sprint-load.ts";
import { expect, it } from "vitest";
import {
  loadDraft,
  scopedDraftKey,
  stageMove,
} from "../src/rebuild/planning-draft.ts";
it("restores staged baseline and independent project identity, and undo removes the net move", () => {
  const data = new Map<string, string>();
  const store = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
  const scope = {
    areaId: "gitex",
    productId: "p",
    sourceId: "azure",
    team: "T",
    backlog: "Stories",
    sprintId: "4",
    iteration: "Root/Sprint 4",
  };
  const move = {
    id: 24,
    title: "Badge",
    rev: 2,
    from: "Root",
    to: scope.iteration,
  };
  const draft = stageMove(loadDraft(store, scope), move);
  store.setItem(scopedDraftKey(scope), JSON.stringify(draft));
  const resumed = loadDraft(store, scope);
  expect(resumed).toEqual(draft);
  expect(stageMove(resumed, { ...move, rev: 3 })).toEqual(draft);
  expect(loadDraft(store, { ...scope, areaId: "other" }).moves).toEqual([]);
  expect(stageMove(resumed, { ...move, to: "Root" })).toEqual({
    ...draft,
    moves: [],
  });
});

it("counts the team's point load once and keeps unestimated work separate across carryovers", () => {
  const cards = [
    { id: 1, title: "A", estimates: [{ name: "Story points", value: 10 }] },
    { id: 2, title: "B", estimates: [{ name: "Story points", value: 8 }] },
    { id: 3, title: "C", estimates: [{ name: "Effort", value: 3 }] },
  ];
  const members = [
    { id: "1", title: "A" },
    { id: "3", title: "C" },
  ];
  const move = { id: 2, rev: 1, title: "B", from: "Root", to: "Sprint 4" };
  expect(plannedLoad(members, cards, [move], "Sprint 4")).toEqual({
    points: 18,
    unknown: ["C"],
  });
  expect(
    plannedLoad(
      members,
      cards,
      [move, { ...move, id: 1, from: "Sprint 4", to: "Sprint 5" }],
      "Sprint 4",
    ),
  ).toEqual({ points: 8, unknown: ["C"] });
});
