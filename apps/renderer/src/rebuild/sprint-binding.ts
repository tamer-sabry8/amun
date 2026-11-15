// Finds which saved Azure DevOps binding the Sprints screen should read. The
// bindings are the ones the Backlog pane saves per product; nothing is new.
import {
  readBoard,
  readSource,
  savedBoards,
  type ScannableStore,
  type SelectionStore,
} from "../backlog-selection.ts";

export type SprintBinding = {
  productId: string;
  sourceId: string;
  team: string;
};
export type SprintArea = {
  id: string;
  productId: string | null;
  lastContextAt: string | null;
  createdAt: string;
};

const defaultKey = "amun.sprints.default";

export function readSprintDefault(
  store: SelectionStore | undefined,
): SprintBinding | undefined {
  try {
    const value: unknown = JSON.parse(store?.getItem(defaultKey) ?? "null");
    if (!value || typeof value !== "object") return undefined;
    const { productId, sourceId, team } = value as Record<string, unknown>;
    return [productId, sourceId, team].every((x) => typeof x === "string" && x)
      ? (value as SprintBinding)
      : undefined;
  } catch {
    return undefined;
  }
}

export function writeSprintDefault(
  store: SelectionStore | undefined,
  binding: SprintBinding,
) {
  try {
    store?.setItem(defaultKey, JSON.stringify(binding));
  } catch {
    // A full or blocked store only means the default is not remembered.
  }
}

function bindingFor(
  store: ScannableStore | undefined,
  productId: string,
): SprintBinding | null {
  const boards = savedBoards(store, productId);
  const chosen = readSource(
    store,
    productId,
    boards.map((b) => b.sourceId),
  );
  const board = boards.find((b) => b.sourceId === chosen) ?? boards[0];
  return board
    ? { productId, sourceId: board.sourceId, team: board.team }
    : null;
}

/** A chosen work area wins; otherwise the default team, then the most recent. */
export function resolveSprintBinding(
  store: ScannableStore | undefined,
  areas: readonly SprintArea[],
  areaId: string,
): SprintBinding | null {
  if (areaId) {
    const productId = areas.find((a) => a.id === areaId)?.productId;
    return productId ? bindingFor(store, productId) : null;
  }
  const saved = readSprintDefault(store);
  if (
    saved &&
    areas.some((a) => a.productId === saved.productId) &&
    readBoard(store, saved.productId, saved.sourceId)
  )
    return saved;
  const recent = areas
    .filter((a) => a.productId)
    .sort((a, b) =>
      (b.lastContextAt ?? b.createdAt).localeCompare(
        a.lastContextAt ?? a.createdAt,
      ),
    );
  for (const area of recent) {
    const found = bindingFor(store, area.productId!);
    if (found) return found;
  }
  return null;
}
