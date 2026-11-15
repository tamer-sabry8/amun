// Finds the sources a reply or document already cites, in the formats Amun
// writes today, and says where each one opens. Only citations that match a
// known document, source or work-item board become links; anything else stays
// plain text. Nothing here reads or writes outside the app.
import { safeUrl } from "./markdown-view.ts";

export type Cite =
  | { kind: "output"; id: string }
  | { kind: "prd" }
  | { kind: "web"; url: string };

export type CitationContext = {
  items: readonly { id: string; title: string }[];
  sources: readonly {
    id: string;
    title: string;
    kind: string;
    reference: string | null;
  }[];
  /** The Azure DevOps project address that "#123" refers to, if any. */
  workItemBase: string | null;
};

export type Piece = string | { label: string; cite: Cite; hint: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATTERN = new RegExp(
  [
    `\\(([^()]*?\\b(?:source )?id:?\\s*(${UUID})[^()]*)\\)`,
    `\\b(?:source )?id:?\\s*(${UUID})`,
    `https?://[^\\s<>"'\\])]+`,
    `\\[([^\\[\\]\\n]+)\\](?!\\()`,
    `(?<![\\w&/#])#(\\d{1,9})\\b`,
  ].join("|"),
  "gi",
);

const lower = (value: string) => value.trim().toLowerCase();

function byId(ctx: CitationContext, id: string) {
  const key = lower(id);
  const item = ctx.items.find((entry) => lower(entry.id) === key);
  if (item)
    return { cite: { kind: "output", id: item.id } as Cite, title: item.title };
  const source = ctx.sources.find((entry) => lower(entry.id) === key);
  if (!source) return null;
  const url = source.reference ? safeUrl(source.reference) : null;
  return {
    cite: (url ? { kind: "web", url } : { kind: "prd" }) as Cite,
    title: source.title,
  };
}

function byTitle(ctx: CitationContext, title: string) {
  const key = lower(title);
  const found = ctx.items.filter((entry) => lower(entry.title) === key);
  return found.length === 1 && found[0]
    ? {
        cite: { kind: "output", id: found[0].id } as Cite,
        title: found[0].title,
      }
    : null;
}

/** Splits plain text into text and clickable citations, in reading order. */
export function splitCitations(text: string, ctx: CitationContext): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  const push = (piece: Piece) => {
    const end = out[out.length - 1];
    if (typeof piece === "string" && typeof end === "string")
      out[out.length - 1] = end + piece;
    else if (piece !== "") out.push(piece);
  };
  for (const match of text.matchAll(PATTERN)) {
    const at = match.index ?? 0;
    const whole = match[0];
    let piece: Piece[] | null = null;
    if (match[1] !== undefined) {
      const hit = byId(ctx, match[2] ?? "");
      if (hit)
        piece = [
          "(",
          { label: match[1], cite: hit.cite, hint: `Open ${hit.title}` },
          ")",
        ];
    } else if (match[3] !== undefined) {
      const hit = byId(ctx, match[3]);
      if (hit)
        piece = [{ label: whole, cite: hit.cite, hint: `Open ${hit.title}` }];
    } else if (whole.startsWith("http")) {
      const trimmed = whole.replace(/[.,;:!?]+$/, "");
      const url = safeUrl(trimmed);
      if (url)
        piece = [
          {
            label: trimmed,
            cite: { kind: "web", url },
            hint: "Open in the browser",
          },
          whole.slice(trimmed.length),
        ];
    } else if (match[4] !== undefined) {
      const hit = byTitle(ctx, match[4]);
      if (hit)
        piece = [
          "[",
          { label: match[4], cite: hit.cite, hint: `Open ${hit.title}` },
          "]",
        ];
    } else if (match[5] !== undefined && ctx.workItemBase) {
      const url = safeUrl(`${ctx.workItemBase}/_workitems/edit/${match[5]}`);
      if (url)
        piece = [
          {
            label: whole,
            cite: { kind: "web", url },
            hint: `Open work item ${whole} in the browser`,
          },
        ];
    }
    if (!piece) continue;
    push(text.slice(last, at));
    for (const part of piece) push(part);
    last = at + whole.length;
  }
  push(text.slice(last));
  return out;
}

type SourceRow = CitationContext["sources"][number];

/** The work-item address comes from the area's product: its chosen Azure DevOps project, else the first one. */
export function citationContext(input: {
  items: CitationContext["items"];
  sources: readonly SourceRow[];
  preferredSourceId?: string;
}): CitationContext {
  const boards = input.sources.filter(
    (source) => source.kind === "ado" && source.reference,
  );
  const board =
    boards.find((source) => source.id === input.preferredSourceId) ?? boards[0];
  const base = board?.reference
    ? (safeUrl(board.reference)?.replace(/\/+$/, "") ?? null)
    : null;
  return {
    items: input.items,
    sources: input.sources,
    workItemBase: base,
  };
}
