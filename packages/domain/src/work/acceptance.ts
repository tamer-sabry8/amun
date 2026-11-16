// An acceptance checklist is Markdown: one task line per item, each citing
// its evidence ("Evidence: test run 412", "Evidence: PR 31", "Evidence: the
// BRD v2", or "Evidence: unknown"). An item without evidence is unknown and
// is never shown as passed.

export const acceptanceType = "acceptance";

const item = /^(\s*[-*+]\s+)\[([ xX])\]\s+(.*)$/;
const evidenceOf = /\bEvidence:\s*(.*)$/i;
const unknownWords =
  /^(?:unknown|none|n\/a|na|tbd|\?|not (?:known|found|available|run|tested|provided))\b/i;

const clean = (line: string) => line.replace(/\s+$/, "");

/** The evidence a line cites, or null when it cites none (unknown). */
function evidence(text: string) {
  const found = evidenceOf.exec(text);
  const value = found?.[1]?.trim().replace(/[.\s]+$/, "") ?? "";
  return !value || unknownWords.test(value) ? null : value;
}

/**
 * Makes the checklist honest: every item names its evidence, an item with
 * none says "unknown", and an unknown item is never ticked.
 */
export function normalizeChecklist(body: string) {
  return body
    .split("\n")
    .map((line) => {
      const match = item.exec(clean(line));
      if (!match) return line;
      const bullet = match[1]!;
      const text = match[3]!;
      if (evidence(text) !== null) return clean(line);
      const claim = text.replace(evidenceOf, "").replace(/[\s—–;·-]+$/, "");
      return `${bullet}[ ] ${claim} — Evidence: unknown`;
    })
    .join("\n");
}

export function checklistSummary(body: string) {
  let items = 0;
  let unknown = 0;
  for (const line of body.split("\n")) {
    const match = item.exec(clean(line));
    if (!match) continue;
    items += 1;
    if (evidence(match[3]!) === null) unknown += 1;
  }
  return { items, unknown, cited: items - unknown };
}
