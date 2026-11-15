// Remembered facts the owner can correct or forget (UC09).

export interface Fact {
  id: string;
  groupId: string | null;
  key: string;
  value: string;
  source: string;
  observedAt: string;
  confirmed: boolean;
  synced: boolean;
}

/** "key: value", the way Firstmate is told about a fact and names it back. */
export const factLine = (fact: Pick<Fact, "key" | "value">) =>
  `${fact.key}: ${fact.value}`;

/**
 * The fact a message names: an exact key or value first, then one whose text
 * contains the words or is contained by them. Null when none or several fit,
 * so a vague name never changes or forgets the wrong one.
 */
export function findFact(facts: Fact[], name: string) {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  const exact = facts.filter(
    (item) =>
      item.key.toLowerCase() === wanted ||
      item.value.toLowerCase() === wanted ||
      factLine(item).toLowerCase() === wanted,
  );
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const near = facts.filter((item) => {
    const line = factLine(item).toLowerCase();
    return line.includes(wanted) || wanted.includes(item.value.toLowerCase());
  });
  return near.length === 1 ? near[0]! : null;
}
