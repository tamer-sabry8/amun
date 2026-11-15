// A plan item that names an Azure DevOps work item that already exists is an
// update of that item, not a new story. Only these two fields can be changed.
export const adoUpdatableFields = ["Assigned to", "Iteration path"] as const;

const references = new Set([
  "workitem",
  "workitemid",
  "workitemnumber",
  "workitemurl",
  "itemid",
  "storyid",
  "existingworkitem",
]);
const label = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

/** True for a field label that names an existing work item. */
export const isAdoItemReference = (key: string) => references.has(label(key));

/**
 * The work item a plan item updates. `named` is true when the item names one
 * at all; `id` is null when what it wrote is not a work item number or link.
 */
export function adoWorkItemOf(fields: Record<string, unknown>) {
  for (const [key, value] of Object.entries(fields)) {
    if (!isAdoItemReference(key)) continue;
    const text = value === null || value === undefined ? "" : String(value);
    if (!text.trim()) continue;
    const match =
      /^#?(\d{1,9})$/.exec(text.trim()) ??
      /\/_?workitems(?:\/edit)?\/(\d{1,9})(?:[/?#]|$)/i.exec(text.trim());
    const id = match ? Number(match[1]) : 0;
    return { named: true as const, id: id > 0 ? id : null };
  }
  return { named: false as const, id: null };
}
