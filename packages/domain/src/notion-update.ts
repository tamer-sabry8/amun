import { createHash } from "node:crypto";

export interface DiffLine {
  kind: "same" | "add" | "remove";
  text: string;
}

/** Line-by-line difference between what Amun last wrote and the new content. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const table = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i]![j] =
        a[i] === b[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i++]! });
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!)
      lines.push({ kind: "remove", text: a[i++]! });
    else lines.push({ kind: "add", text: b[j++]! });
  }
  while (i < a.length) lines.push({ kind: "remove", text: a[i++]! });
  while (j < b.length) lines.push({ kind: "add", text: b[j++]! });
  return lines;
}

/**
 * What a Notion page looked like when it was read: Notion's own edit time
 * when it reports one, and a fingerprint of the title and content, so an
 * edit inside the same minute is still seen.
 */
export function notionPageVersion(page: {
  title?: string | undefined;
  content: string;
  editedTime?: string | null | undefined;
}) {
  const hash = createHash("sha256")
    .update(JSON.stringify([page.title ?? null, page.content]))
    .digest("hex");
  return `${page.editedTime ?? ""}|${hash}`;
}
