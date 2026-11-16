// Remembers which Azure project, team and backlog level a product's backlog
// was last pointed at. Kept per product and per project; nothing is global.
// Only choices are stored, never work items, and restoring never publishes.

export type SelectionStore = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;
export type BoardSelection = { team: string; level: string };

const sourceKey = (productId: string) => `amun.backlog.source:${productId}`;
const boardKey = (productId: string, sourceId: string) =>
  `amun.backlog.board:${productId}:${sourceId}`;

export function browserStore(): ScannableStore | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function read(store: SelectionStore | undefined, key: string) {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(store: SelectionStore | undefined, key: string, value: string) {
  try {
    if (value) store?.setItem(key, value);
    else store?.removeItem(key);
  } catch {
    // A full or blocked store only means the choice is not remembered.
  }
}

/** The remembered project, only if it is still mapped to this product. */
export function readSource(
  store: SelectionStore | undefined,
  productId: string,
  mapped: readonly string[],
) {
  const saved = read(store, sourceKey(productId));
  return saved && mapped.includes(saved) ? saved : "";
}

export function writeSource(
  store: SelectionStore | undefined,
  productId: string,
  sourceId: string,
) {
  write(store, sourceKey(productId), sourceId);
}

export function readBoard(
  store: SelectionStore | undefined,
  productId: string,
  sourceId: string,
): BoardSelection | undefined {
  const raw = read(store, boardKey(productId, sourceId));
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return undefined;
    const { team, level } = value as Record<string, unknown>;
    if (typeof team !== "string" || !team) return undefined;
    return { team, level: typeof level === "string" ? level : "" };
  } catch {
    return undefined;
  }
}

export function writeBoard(
  store: SelectionStore | undefined,
  productId: string,
  sourceId: string,
  selection: BoardSelection | undefined,
) {
  write(
    store,
    boardKey(productId, sourceId),
    selection?.team ? JSON.stringify(selection) : "",
  );
}

export type ScannableStore = SelectionStore & Pick<Storage, "key" | "length">;

/** Every project of a product that has a saved board, in storage order. */
export function savedBoards(
  store: ScannableStore | undefined,
  productId: string,
) {
  const prefix = boardKey(productId, "");
  const found: { sourceId: string; team: string; level: string }[] = [];
  try {
    for (let i = 0; store && i < store.length; i++) {
      const key = store.key(i);
      if (!key?.startsWith(prefix)) continue;
      const sourceId = key.slice(prefix.length);
      const board = readBoard(store, productId, sourceId);
      if (sourceId && board) found.push({ sourceId, ...board });
    }
  } catch {
    // An unreadable store only means nothing is remembered.
  }
  return found;
}
