import { z } from "zod";
import type { SelectionStore } from "../backlog-selection.ts";

export interface PlanningScope {
  areaId: string;
  productId: string;
  sourceId: string;
  team: string;
  backlog: string;
  sprintId: string;
  iteration: string;
}

const move = z.object({
  id: z.number().int().positive(),
  rev: z.number().int().positive(),
  title: z.string(),
  from: z.string().min(1),
  to: z.string().min(1),
});
export type PlannedMove = z.infer<typeof move>;
const savedDraft = z.object({ id: z.uuid(), moves: z.array(move) });
export type PlanningDraft = z.infer<typeof savedDraft>;

export function scopedDraftKey(scope: PlanningScope) {
  return (
    "amun.planning.v1:" +
    JSON.stringify([
      scope.areaId,
      scope.productId,
      scope.sourceId,
      scope.team,
      scope.backlog,
      scope.sprintId,
    ])
  );
}

export function loadDraft(
  store: SelectionStore | undefined,
  scope: PlanningScope,
): PlanningDraft {
  const raw = store?.getItem(scopedDraftKey(scope));
  if (raw) return savedDraft.parse(JSON.parse(raw));
  return { id: crypto.randomUUID(), moves: [] };
}

export function stageMove(
  draft: PlanningDraft,
  move: PlannedMove,
): PlanningDraft {
  const previous = draft.moves.find((entry) => entry.id === move.id);
  const next = previous ? { ...previous, to: move.to } : move;
  const moves = draft.moves.filter((entry) => entry.id !== move.id);
  if (next.from !== next.to) {
    if (previous)
      return {
        ...draft,
        moves: draft.moves.map((entry) =>
          entry.id === next.id ? next : entry,
        ),
      };
    moves.push(next);
  }
  return { ...draft, moves };
}
