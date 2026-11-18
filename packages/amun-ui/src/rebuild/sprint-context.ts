// What Firstmate is told about an Azure DevOps sprint when the owner writes to
// it from the Sprints screen. It is kept for the next message in that work
// area and then dropped, so it is never sent twice or stale.
import type { SprintItems } from "./sprint-azure.ts";

const held = new Map<string, { text: string; at: number }>();
const lifetime = 10 * 60_000;

export function holdSprintContext(areaId: string, text: string) {
  held.set(areaId, { text, at: Date.now() });
}

export function takeSprintContext(areaId: string, now = Date.now()) {
  const found = held.get(areaId);
  held.delete(areaId);
  return found && now - found.at <= lifetime ? found.text : "";
}

const shown = 60;
export function sprintContextText(input: {
  team: string;
  sprints: { name: string; path: string }[];
  open?: { name: string; path: string; items: SprintItems["items"] } | null;
}) {
  const sprints = input.sprints
    .map((sprint) => `${sprint.name} = ${sprint.path}`)
    .join("; ");
  const open = input.open
    ? ` The owner has ${input.open.name} (${input.open.path}) open. Its work items: ${
        input.open.items.length
          ? input.open.items
              .slice(0, shown)
              .map(
                (item) =>
                  `#${item.id} “${item.title}” (${item.type}, ${item.state}, ${item.assignee ?? "unassigned"})`,
              )
              .join("; ") +
            (input.open.items.length > shown
              ? `; and ${input.open.items.length - shown} more`
              : "")
          : "none"
      }.`
    : "";
  return `Azure DevOps sprints for ${input.team}, read from Azure DevOps: ${sprints || "none"}.${open} To move stories into a sprint, change who a story is assigned to, or commit a sprint, raise one plan with destination "ado" and one item per existing work item, with exactly these fields: "workitem" (the number), "iteration" (the sprint path above, exactly) and/or "assignedto" (the person's name or email). Put no type, description or other field on such an item. "Commit the sprint" means putting the stories the owner names into that sprint; if they name none, ask which. Nothing is written until the owner approves exactly that list.`;
}
