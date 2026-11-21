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
