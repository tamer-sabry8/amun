// Reads a question and its choices out of the First Mate's own words, so the
// question card can offer 2 to 4 buttons without asking Firstmate to change
// how it writes. Anything this cannot read stays a plain question: the card
// then shows only "Write my own response".

export interface ParsedQuestion {
  /** The question sentence itself. */
  question: string;
  /** 2 to 4 short labels, or none when the reply offers no clear choices. */
  options: string[];
  /** Index into options of the one the First Mate recommends, if it said. */
  recommended: number | null;
  /** The First Mate's reason for its recommendation, if it gave one. */
  why: string | null;
}

const ITEM =
  /^\s*(?:(?:\d{1,2}|[A-Da-d])[.)]|\((?:\d{1,2}|[A-Da-d])\)|[-*•])\s+(.+?)\s*$/;
const MARKER = /^\s*(?:\(?(\d{1,2}|[A-Da-d])[.)])/;
const RECOMMENDED_TAG =
  /\s*[([]\s*recommended\s*[)\]]|\s*[—–-]\s*recommended\b\.?|\s*\brecommended\s*$/i;
const RECOMMEND_LINE =
  /^\s*(?:\*\*)?(?:my\s+)?recommend(?:ed|ation)?(?:\*\*)?\s*[:—–-]\s*(.+)$|^\s*I\s+(?:would\s+)?recommend\s+(.+)$/i;

function clean(text: string): string {
  return text
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Option A — longer explanation" → "Option A" when the head is short. */
function labelOf(item: string): { label: string; rest: string | null } {
  const text = clean(item);
  const split = text.match(/^(.{2,60}?)\s*(?:[—–]|\s-\s|:)\s+(.+)$/);
  if (split) return { label: split[1]!.trim(), rest: split[2]!.trim() };
  return { label: text, rest: null };
}

function markerOf(line: string): string | null {
  const found = line.match(MARKER);
  return found ? found[1]!.toLowerCase() : null;
}

export function parseQuestion(text: string): ParsedQuestion | null {
  const lines = text.replace(/\r/g, "").split("\n");
  // The last line that asks something is the question this card answers.
  let at = -1;
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]!;
    if (/\?\s*(?:\*\*)?\s*$/.test(line) && !ITEM.test(line)) {
      at = index;
      break;
    }
  }
  if (at === -1) return null;
  const question = clean(lines[at]!)
    .replace(/^#+\s*/, "")
    .replace(/^question\s*:\s*/i, "");

  // Choices are the list right after the question, or right before it.
  const collect = (from: number, step: 1 | -1) => {
    const found: { line: string; marker: string | null }[] = [];
    let index = from;
    // Blank lines and a recommendation line may sit between list and question.
    while (
      index >= 0 &&
      index < lines.length &&
      (!lines[index]!.trim() || RECOMMEND_LINE.test(lines[index]!))
    )
      index += step;
    while (index >= 0 && index < lines.length) {
      const line = lines[index]!;
      const item = line.match(ITEM);
      if (!item) break;
      found.push({ line: item[1]!, marker: markerOf(line) });
      index += step;
    }
    return step === 1 ? found : found.reverse();
  };
  let items = collect(at + 1, 1);
  if (items.length < 2) items = collect(at - 1, -1);

  const options: string[] = [];
  const markers: (string | null)[] = [];
  let recommended: number | null = null;
  let why: string | null = null;
  if (items.length >= 2 && items.length <= 4) {
    items.forEach((item, index) => {
      const tagged = RECOMMENDED_TAG.test(item.line);
      const { label, rest } = labelOf(item.line.replace(RECOMMENDED_TAG, ""));
      options.push(label);
      markers.push(item.marker);
      if (tagged && recommended === null) {
        recommended = index;
        why = rest || null;
      }
    });
  }

  // "Recommendation: B, because …" anywhere in the reply. It also gives the
  // reason when the list only tagged an option "(recommended)".
  if (options.length && (recommended === null || why === null)) {
    for (const line of lines) {
      const found = line.match(RECOMMEND_LINE);
      if (!found) continue;
      const said = clean(found[1] ?? found[2] ?? "");
      const lower = said.toLowerCase();
      const byMarker = markers.findIndex(
        (marker) =>
          marker !== null &&
          new RegExp(`^(?:option\\s+)?\\(?${marker}\\b`).test(lower),
      );
      const byLabel = options.findIndex((option) =>
        lower.startsWith(option.toLowerCase()),
      );
      const index = byMarker !== -1 ? byMarker : byLabel;
      if (index === -1 || (recommended !== null && index !== recommended))
        continue;
      recommended = index;
      const reason =
        said.match(/\b(?:because|since)\s+(.+)$/i) ??
        said.match(/(?::|[—–]|,)\s+(.+)$/);
      why = reason ? reason[1]!.replace(/\.$/, "") : null;
      break;
    }
  }
  return { question, options, recommended, why };
}

/** Whether a reply is about Azure DevOps, so the card can offer to connect it. */
export function mentionsAzureDevOps(text: string): boolean {
  return /azure\s*devops|\bADO\b|dev\.azure\.com/i.test(text);
}
