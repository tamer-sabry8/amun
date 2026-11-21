import type { PlannedMove, PlanningScope } from "./planning-draft.ts";

export function teamBudgetKey(scope: PlanningScope) {
  return (
    "amun.sprint-budget.v1:" +
    JSON.stringify([
      scope.productId,
      scope.sourceId,
      scope.team,
      scope.sprintId,
    ])
  );
}

export function plannedLoad(
  members: readonly { id: string; title: string }[],
  cards: readonly {
    id: number;
    title: string;
    estimates?: { name: string; value: number }[] | undefined;
  }[],
  moves: readonly PlannedMove[],
  iteration: string,
) {
  const included = new Map(members.map((m) => [m.id, m.title]));
  for (const m of moves) {
    if (m.from === m.to) continue;
    if (m.to === iteration) included.set(String(m.id), m.title);
    else if (m.from === iteration) included.delete(String(m.id));
  }
  const byId = new Map(cards.map((card) => [String(card.id), card]));
  const unknown: string[] = [];
  let points = 0;
  for (const [id, title] of included) {
    const estimate = byId
      .get(id)
      ?.estimates?.find((e) => e.name === "Story points")?.value;
    if (estimate === undefined) unknown.push(title);
    else points += estimate;
  }
  return { points, unknown };
}
