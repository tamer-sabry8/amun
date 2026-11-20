export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; children: Inline[] }
  | { kind: "italic"; children: Inline[] }
  | { kind: "link"; url: string; children: Inline[] }
  /** A file or folder on this Mac, shown with a way to open it in Finder. */
  | { kind: "path"; path: string };

export type ListItem = {
  content: Inline[];
  /** Present for "- [ ] text" items; `line` is the index in the body's lines. */
  task?: { checked: boolean; line: number; label: string };
};

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; content: Inline[] }
  | { kind: "rule" }
  | { kind: "code"; text: string }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][] }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "paragraph"; lines: Inline[][] };

const TOKEN =
  /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^\s)]+)\)|\*(?=\S)([^*]+?)\*|(?<![\w])_(?=\S)([^_]+?)_(?![\w])/g;

/** Only web addresses can become links; anything else stays as its label. */
export const safeUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
};

/**
 * A path on this Mac: under the home folder (~/…) or one of the top folders
 * macOS has. Anything else that starts with a slash (a typed command, a web
 * path) is left alone.
 */
const LOCAL_PATH =
  /(?<![\w/.:~-])(?:~|\/(?:Users|Applications|Library|Volumes|private|tmp|var|opt|usr|etc))(?:\/[^\s"'`<>()[\]{}|*?]+)+/g;

/** The whole of `text` when it is one local path, as written in code marks. */
export function localPath(text: string): string | null {
  const found = text.trim().match(LOCAL_PATH);
  return found?.length === 1 && found[0] === text.trim() ? found[0] : null;
}

/** Splits plain text into text and the local paths written in it. */
function withPaths(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(LOCAL_PATH)) {
    // A sentence's own full stop or comma is not part of the path.
    const path = match[0].replace(/[.,;:!]+$/, "");
    const at = match.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    out.push({ kind: "path", path });
    last = at + path.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of source.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) out.push(...withPaths(source.slice(last, at)));
    if (match[1] !== undefined)
      out.push({ kind: "bold", children: parseInline(match[1]) });
    else if (match[2] !== undefined) {
      const path = localPath(match[2]);
      out.push(
        path ? { kind: "path", path } : { kind: "code", text: match[2] },
      );
    } else if (match[3] !== undefined) {
      const url = safeUrl(match[4] ?? "");
      const children = parseInline(match[3]);
      if (url) out.push({ kind: "link", url, children });
      else out.push(...children);
    } else
      out.push({
        kind: "italic",
        children: parseInline(match[5] ?? match[6] ?? ""),
      });
    last = at + match[0].length;
  }
  if (last < source.length) out.push(...withPaths(source.slice(last)));
  return out;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*```/;
const BULLET = /^\s*-\s/;
const NUMBERED = /^\s*\d+\.\s/;
const TASK = /^\[( |x)\]\s(.*)$/i;
const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const isRule = (line: string) => /^---+$/.test(line.trim());
const isTableLine = (line: string) => line.trim().startsWith("|");
const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => parseInline(cell.trim()));
const startsBlock = (line: string) =>
  /^#{1,6}\s/.test(line) ||
  FENCE.test(line) ||
  isTableLine(line) ||
  BULLET.test(line) ||
  NUMBERED.test(line) ||
  isRule(line);

export function parseMarkdown(body: string): Block[] {
  const lines = body.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i++;
      continue;
    }
    if (FENCE.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i] ?? "")) {
        code.push(lines[i] ?? "");
        i++;
      }
      i++;
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: (heading[1] ?? "#").length as 1 | 2 | 3 | 4 | 5 | 6,
        content: parseInline(heading[2] ?? ""),
      });
      i++;
      continue;
    }
    if (isRule(line)) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }
    if (isTableLine(line) && SEPARATOR.test(lines[i + 1] ?? "x")) {
      const header = cells(line);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && isTableLine(lines[i] ?? "")) {
        rows.push(cells(lines[i] ?? ""));
        i++;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }
    if (BULLET.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length && BULLET.test(lines[i] ?? "")) {
        const text = (lines[i] ?? "").replace(BULLET, "");
        const task = TASK.exec(text);
        items.push(
          task
            ? {
                content: parseInline(task[2] ?? ""),
                task: {
                  checked: (task[1] ?? "").toLowerCase() === "x",
                  line: i,
                  label: task[2] ?? "",
                },
              }
            : { content: parseInline(text) },
        );
        i++;
      }
      blocks.push({ kind: "list", ordered: false, items });
      continue;
    }
    if (NUMBERED.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length && NUMBERED.test(lines[i] ?? "")) {
        items.push({
          content: parseInline((lines[i] ?? "").replace(NUMBERED, "")),
        });
        i++;
      }
      blocks.push({ kind: "list", ordered: true, items });
      continue;
    }
    const paragraph: Inline[][] = [parseInline(line)];
    i++;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (!next.trim() || startsBlock(next)) break;
      paragraph.push(parseInline(next));
      i++;
    }
    blocks.push({ kind: "paragraph", lines: paragraph });
  }
  return blocks;
}

/** Flips one task line's box and leaves every other line untouched. */
export function toggleTask(body: string, line: number): string {
  const lines = body.split("\n");
  const current = lines[line];
  if (current === undefined) return body;
  lines[line] = current.replace(
    /^(\s*-\s\[)( |x|X)(\]\s)/,
    (_all, open: string, mark: string, close: string) =>
      open + (mark === " " ? "x" : " ") + close,
  );
  return lines.join("\n");
}

/** The Table snippet, led by a blank line so the table renders after text. */
export function tableSnippet(before: string): string {
  const lead =
    before === "" || before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
  return lead + "| Column | Column |\n| --- | --- |\n|  |  |\n";
}
