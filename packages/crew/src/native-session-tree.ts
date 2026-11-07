export interface SessionEntryRef {
  id: string;
  parentId: string | null;
  type: string;
}
export function sessionTree(entries: SessionEntryRef[], leaf: string | null) {
  if (entries.length > 2048) throw Error("Session tree too large");
  const ids = new Set<string>(),
    children = new Map<string | null, SessionEntryRef[]>();
  for (const entry of entries) {
    if (
      !/^[a-zA-Z0-9_-]{1,128}$/.test(entry.id) ||
      !/^\w{1,64}$/.test(entry.type) ||
      ids.has(entry.id)
    )
      throw Error("Invalid session entry");
    ids.add(entry.id);
    const siblings = children.get(entry.parentId) ?? [];
    siblings.push(entry);
    children.set(entry.parentId, siblings);
  }
  if (leaf !== null && !ids.has(leaf)) throw Error("Unknown current entry");
  const pending = (children.get(null) ?? [])
    .map((entry) => ({ entry, depth: 0 }))
    .reverse();
  const rows = [];
  while (pending.length) {
    const { entry, depth } = pending.pop()!;
    rows.push({
      id: entry.id,
      type: entry.type,
      depth,
      current: entry.id === leaf,
    });
    const siblings = children.get(entry.id) ?? [];
    for (let i = siblings.length - 1; i >= 0; i--)
      pending.push({ entry: siblings[i]!, depth: depth + 1 });
  }
  if (rows.length !== entries.length)
    throw Error("Disconnected session entries");
  return rows;
}
