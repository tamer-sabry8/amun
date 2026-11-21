import {
  plannedStory,
  reviewedOrder,
  statusEdit,
  ownerEdit,
} from "@amun/contracts";
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
  addLabels: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(128)
        .regex(/^[^;\r\n]+$/),
    )
    .min(1)
    .max(30)
    .optional(),
  reorder: reviewedOrder.optional(),
  status: statusEdit.optional(),
  owner: ownerEdit.optional(),
  targetSprintId: z.string().min(1).optional(),
});
export type PlannedMove = z.infer<typeof move>;
const submission = z.object({
  ref: z.string(),
  chatId: z.string(),
  moves: z.array(move),
  creates: z.array(plannedStory).optional(),
});
const savedDraft = z.object({
  id: z.uuid(),
  moves: z.array(move),
  submissions: z.array(submission).optional(),
  creates: z
    .array(
      plannedStory.extend({
        title: z.string(),
        criteria: z.array(z.string()),
        labels: z.array(z.string()),
      }),
    )
    .optional(),
});
export type PlanningDraft = z.infer<typeof savedDraft>;

export function scopedDraftKey(scope: Omit<PlanningScope, "iteration">) {
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
  scope: Omit<PlanningScope, "iteration">,
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
  const next = previous
    ? { ...previous, ...move, rev: previous.rev, from: previous.from }
    : move;
  const moves = draft.moves.filter((entry) => entry.id !== move.id);
  if (
    next.from !== next.to ||
    next.addLabels?.length ||
    next.reorder ||
    next.status ||
    next.owner
  ) {
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

export function planningChangeCount(moves: readonly PlannedMove[]) {
  return moves.reduce(
    (n, m) =>
      n +
      Number(m.from !== m.to) +
      Number(!!m.addLabels?.length) +
      Number(!!m.reorder) +
      Number(!!m.status) +
      Number(!!m.owner),
    0,
  );
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
      if (draft.moves.length || draft.creates?.length)
        links.push({
          areaId,
          productId,
          sourceId,
          team,
          backlog,
          sprintId,
          id: draft.id,
          count:
            planningChangeCount(draft.moves) + (draft.creates?.length ?? 0),
        });
    } catch {
      /* Ignore unreadable entries without changing storage. */
    }
  }
  return links;
}
