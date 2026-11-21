import type { BacklogResult } from "@amun/contracts";
import type { PlannedMove } from "./planning-draft.ts";
type Read = Extract<BacklogResult, { view: "cards" }>;
type Card = Read["cards"][number];
export function PlanningFields({
  card,
  pending,
  options,
  stage,
  disabled,
}: {
  card: Card;
  pending: PlannedMove | undefined;
  options: Pick<Read, "transitions" | "identities">;
  stage(move: PlannedMove): void;
  disabled: boolean;
}) {
  if (!card.iteration) return null;
  const baseline = {
    id: card.id,
    title: card.title,
    rev: card.rev,
    from: card.iteration,
    to: card.iteration,
  };
  const states = options.transitions?.[card.type]?.[card.state] ?? [];
  const people = options.identities ?? [];
  return (
    <details>
      <summary>Edit status or owner</summary>
      <label className="field">
        Status
        <select
          disabled={disabled || !states.length}
          value={pending?.status?.to ?? card.state}
          onChange={(e) =>
            stage({
              ...baseline,
              ...pending,
              status:
                e.target.value === card.state
                  ? undefined
                  : { from: card.state, to: e.target.value },
            })
          }
        >
          {[...new Set([card.state, ...states])].map((state) => (
            <option key={state}>{state}</option>
          ))}
        </select>
      </label>
      <label className="field">
        Owner
        <select
          disabled={
            disabled || !people.length || !!(card.assignee && !card.assigneeId)
          }
          value={pending?.owner?.to.id ?? card.assigneeId ?? ""}
          onChange={(e) => {
            const to = people.find((person) => person.id === e.target.value);
            stage({
              ...baseline,
              ...pending,
              owner:
                to && to.id !== card.assigneeId
                  ? { from: card.assigneeId ?? null, to }
                  : undefined,
            });
          }}
        >
          {!people.some((p) => p.id === card.assigneeId) && (
            <option value={card.assigneeId ?? ""}>
              {card.assignee ?? "Unassigned"}
            </option>
          )}
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.uniqueName}
            </option>
          ))}
        </select>
      </label>
    </details>
  );
}
