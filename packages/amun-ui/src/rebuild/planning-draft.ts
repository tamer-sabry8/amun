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
const submission = z.object({
  ref: z.string(),
  chatId: z.string(),
  moves: z.array(move),
});
const savedDraft = z.object({
  id: z.uuid(),
  moves: z.array(move),
  submissions: z.array(submission).optional(),
});
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

export interface SavedPlanningLink {
  areaId: string;
  productId: string;
  sourceId: string;
  team: string;
  backlog: string;
  sprintId: string;
  id: string;
  count: number;
}
export function savedPlanningLinks(
  store: (SelectionStore & Pick<Storage, "key" | "length">) | undefined,
  areaIds: ReadonlySet<string>,
) {
  const links: SavedPlanningLink[] = [];
  if (!store) return links;
  const prefix = "amun.planning.v1:";
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key?.startsWith(prefix)) continue;
    try {
      const [areaId, productId, sourceId, team, backlog, sprintId] = z
        .tuple([
          z.string(),
          z.string(),
          z.string(),
          z.string(),
          z.string(),
          z.string(),
        ])
        .parse(JSON.parse(key.slice(prefix.length)));
      if (!areaIds.has(areaId)) continue;
      const draft = savedDraft.parse(JSON.parse(store.getItem(key) ?? "null"));
      if (draft.moves.length)
        links.push({
          areaId,
          productId,
          sourceId,
          team,
          backlog,
          sprintId,
          id: draft.id,
          count: draft.moves.length,
        });
    } catch {
      /* Ignore unreadable entries without changing storage. */
    }
  }
  return links;
}
