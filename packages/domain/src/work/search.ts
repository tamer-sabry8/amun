// Search by content: turns what the owner typed into a full-text query.
// The index stems words ("pricing" finds "prices"); this adds words that mean
// nearly the same thing in product work. There is no embedding model in the
// app, so matching is by words and their near-synonyms, not by meaning.

const synonymGroups = [
  ["bug", "defect", "issue", "fault", "problem", "error"],
  ["requirement", "need", "spec", "specification", "criteria"],
  ["customer", "client", "user", "buyer"],
  ["price", "cost", "fee", "budget", "charge", "billing"],
  ["deadline", "due", "date", "schedule", "timeline"],
  ["release", "launch", "ship", "rollout"],
  ["risk", "threat", "concern", "danger"],
  ["goal", "objective", "target", "aim", "outcome"],
  ["story", "ticket", "task"],
  ["meeting", "call", "interview", "session", "workshop"],
  ["plan", "roadmap", "strategy"],
  ["decision", "choice", "verdict", "decide"],
  ["slow", "latency", "performance", "lag"],
  ["login", "signin", "authentication", "password"],
  ["competitor", "rival", "alternative"],
  ["feedback", "comment", "review", "opinion"],
  ["quality", "test", "testing", "qa"],
  ["approve", "sign", "accept", "authorise", "authorize"],
  ["document", "doc", "paper", "write-up"],
] as const;

const stopWords = new Set(
  "a an and are as at be by for from how in is it of on or so that the this to was what when where which who with".split(
    " ",
  ),
);

/** Strips the common endings so "launches" and "launch" meet. */
const root = (word: string) =>
  word.replace(/(ing|ed|es|s)$/, (end) => (word.length > 5 ? "" : end));

export function searchWords(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const kept = words.filter((word) => word.length > 1 && !stopWords.has(word));
  return (kept.length ? kept : words.filter((word) => word.length > 1)).slice(
    0,
    8,
  );
}

export function synonymsOf(word: string): string[] {
  const key = root(word);
  const group = synonymGroups.find((words) =>
    words.some((entry) => entry === word || root(entry) === key),
  );
  return group ? group.filter((entry) => entry !== word) : [];
}

/**
 * The full-text expression for what was typed, or null when nothing is
 * searchable. Every word must appear (or one of its near-synonyms); the last
 * word also matches as a prefix because it may still be being typed. With
 * `any`, one word is enough, used when nothing matched them all.
 */
export function matchExpression(
  query: string,
  mode: "all" | "any" = "all",
): string | null {
  const words = searchWords(query);
  if (!words.length) return null;
  const quote = (word: string) => `"${word}"`;
  const parts = words.map((word, index) => {
    const alternatives = [word, ...synonymsOf(word)].map(quote);
    if (index === words.length - 1) alternatives.push(`${quote(word)}*`);
    return `(${alternatives.join(" OR ")})`;
  });
  return parts.join(mode === "all" ? " AND " : " OR ");
}

export type SnippetPart = { text: string; match: boolean };

const open = "\u0001";
const close = "\u0002";
export const snippetMarks = { open, close } as const;

/** Splits an FTS snippet written with the marks above into plain parts. */
export function snippetParts(raw: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let match = false;
  for (const piece of raw.split(/([\u0001\u0002])/)) {
    if (piece === open) match = true;
    else if (piece === close) match = false;
    else if (piece) parts.push({ text: piece.replace(/\s+/g, " "), match });
  }
  return parts;
}
