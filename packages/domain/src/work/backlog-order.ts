export type ReviewedOrder = {
  beforeId: number;
  anchorRev: number;
  oldNext: number | null;
};
export function placeBefore<T extends { id: number }>(
  records: readonly T[],
  id: number,
  beforeId: number,
) {
  const record = records.find((r) => r.id === id);
  if (!record || id === beforeId) return [...records];
  const remaining = records.filter((r) => r.id !== id);
  const index = remaining.findIndex((r) => r.id === beforeId);
  if (index < 0) return [...records];
  remaining.splice(index, 0, record);
  return remaining;
}
export function successor(records: readonly { id: number }[], id: number) {
  const i = records.findIndex((r) => r.id === id);
  return i < 0 ? undefined : (records[i + 1]?.id ?? null);
}
type Ranked = {
  id: number;
  rev: number;
  rank?: { field: string; value: number } | undefined;
};
export function reviewedRank(
  cards: readonly Ranked[],
  id: number,
  order: ReviewedOrder,
) {
  const item = cards.find((c) => c.id === id),
    anchor = cards.find((c) => c.id === order.beforeId);
  if (
    !item?.rank ||
    !anchor?.rank ||
    anchor.rev !== order.anchorRev ||
    anchor.id === id ||
    successor(cards, id) !== order.oldNext
  )
    return null;
  const field = item.rank.field;
  if (
    !cards.every(
      (c, i) =>
        c.rank?.field === field &&
        (i === 0 || c.rank.value > cards[i - 1]!.rank!.value),
    )
  )
    return null;
  const layout = placeBefore(cards, id, anchor.id),
    index = layout.findIndex((c) => c.id === id);
  const upper = anchor.rank.value,
    lower = index === 0 ? upper - 2 : layout[index - 1]!.rank!.value;
  const value = lower + (upper - lower) / 2;
  return Number.isFinite(value) && lower < value && value < upper
    ? { field, value }
    : null;
}
