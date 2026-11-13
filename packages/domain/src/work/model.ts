// UX rebuild conceptual model (Amun_UX_Rebuild_Handoff §3, reconciled §3).
// Groups scope everything; work areas, supporting records, objectives and
// execution records stay distinct. Pure logic only: no storage, no I/O.

export const workTypes = ["product", "project", "task", "rfp"] as const;
export type WorkType = (typeof workTypes)[number];
export const recordTypes = [
  "idea",
  "problem",
  "interview",
  "document",
] as const;
export type RecordType = (typeof recordTypes)[number];
// "unresolved" is the no-answer state (F2): never treated as intentionally unlinked.
export const linkageStates = [
  "linked",
  "link_later",
  "unlinked",
  "unresolved",
] as const;
export type LinkageState = (typeof linkageStates)[number];

export interface Group {
  id: string;
  name: string;
}
export interface WorkArea {
  id: string;
  groupId: string | null;
  type: WorkType;
  name: string;
  status: string;
}
export interface SupportingRecord {
  id: string;
  groupId: string | null;
  type: RecordType;
  title: string;
  linkage: LinkageState;
  links: string[];
}

export type MaterialKind =
  | { kind: "record"; type: RecordType }
  | { kind: "work"; type: WorkType }
  | { kind: "objective" }
  | { kind: "execution" }
  | { kind: "unreadable" };

const has = (text: string, ...words: string[]) =>
  words.some((word) => new RegExp(`\\b${word}`, "i").test(text));

/**
 * Decision table from §3 ("which concept to use"). A deterministic first pass
 * so intake works without a model; Firstmate may override the suggestion.
 */
export function classifyMaterial(input: {
  text: string;
  fileNames?: string[];
  readable?: boolean;
}): MaterialKind {
  if (input.readable === false) return { kind: "unreadable" };
  const text = input.text.trim();
  const files = input.fileNames ?? [];
  if (!text && !files.length) return { kind: "unreadable" };
  if (has(text, "rfp", "tender", "request for proposal"))
    return { kind: "work", type: "rfp" };
  if (
    /\b\d{1,3}\s?%/.test(text) &&
    has(text, "target", "reach", "increase", "reduce", "improve", "okr")
  )
    return { kind: "objective" };
  if (has(text, "okr", "objective:", "key result"))
    return { kind: "objective" };
  if (has(text, "interview", "transcript", "call notes"))
    return { kind: "record", type: "interview" };
  if (has(text, "story", "bug", "ticket", "pbi", "work item"))
    return { kind: "execution" };
  if (has(text, "brd", "client delivery", "deliver for", "delivery project"))
    return { kind: "work", type: "project" };
  if (has(text, "product", "roadmap", "prd"))
    return { kind: "work", type: "product" };
  if (has(text, "idea", "what if", "we could"))
    return { kind: "record", type: "idea" };
  if (has(text, "problem", "issue", "friction", "pain point", "complain"))
    return { kind: "record", type: "problem" };
  if (!text && files.length) return { kind: "record", type: "document" };
  if (has(text, "reading", "article", "paper", "for reference"))
    return { kind: "record", type: "document" };
  return { kind: "work", type: "task" };
}

const tokens = (value: string) =>
  new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2),
  );

export interface AreaInference {
  confident: WorkArea | null;
  options: WorkArea[];
}
/**
 * Work-area link (Q30): confident → file it and show a changeable chip;
 * otherwise one card with options. Only areas in the active group are
 * candidates, so inference can never cross a group boundary (UC09).
 */
export function inferWorkArea(
  text: string,
  areas: WorkArea[],
  groupId: string | null,
): AreaInference {
  const words = tokens(text);
  const scored = areas
    .filter((area) => groupId === null || area.groupId === groupId)
    .map((area) => {
      const name = [...tokens(area.name)];
      const hits = name.filter((word) => words.has(word)).length;
      return { area, score: name.length ? hits / name.length : 0 };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.area.name.localeCompare(b.area.name),
    );
  const [first, second] = scored;
  const confident =
    first && first.score === 1 && (!second || second.score < 1)
      ? first.area
      : null;
  return { confident, options: scored.slice(0, 4).map((entry) => entry.area) };
}

export type LinkChoice =
  | { choice: "link"; workAreaIds: string[] }
  | { choice: "later" }
  | { choice: "never" }
  | { choice: "none" };

export type LinkOutcome =
  | { ok: true; linkage: LinkageState; links: string[]; followUp: boolean }
  | { ok: false; reason: "cross_group"; workAreaIds: string[] }
  | { ok: false; reason: "unknown_area" | "empty" };

/**
 * F2 linking. `grants` lists work areas in other groups the user has already
 * permitted for this record; anything else across groups must be asked (UC03).
 */
export function linkRecord(
  record: Pick<SupportingRecord, "groupId" | "links">,
  choice: LinkChoice,
  areas: WorkArea[],
  grants: string[] = [],
): LinkOutcome {
  if (choice.choice === "later")
    return {
      ok: true,
      linkage: "link_later",
      links: record.links,
      followUp: true,
    };
  if (choice.choice === "never")
    return { ok: true, linkage: "unlinked", links: [], followUp: false };
  if (choice.choice === "none")
    return {
      ok: true,
      linkage: record.links.length ? "linked" : "unresolved",
      links: record.links,
      followUp: false,
    };
  if (!choice.workAreaIds.length) return { ok: false, reason: "empty" };
  const targets = choice.workAreaIds.map((id) =>
    areas.find((area) => area.id === id),
  );
  if (targets.some((area) => !area))
    return { ok: false, reason: "unknown_area" };
  const crossing = (targets as WorkArea[]).filter(
    (area) => area.groupId !== record.groupId && !grants.includes(area.id),
  );
  if (crossing.length)
    return {
      ok: false,
      reason: "cross_group",
      workAreaIds: crossing.map((area) => area.id),
    };
  return {
    ok: true,
    linkage: "linked",
    links: [...new Set([...record.links, ...choice.workAreaIds])],
    followUp: false,
  };
}

export type IntakeStep =
  | { step: "ask_group" }
  | { step: "unreadable" }
  | { step: "save_record"; type: RecordType; ask: "link" }
  | { step: "define_objective" }
  | { step: "route_execution" }
  | { step: "file_work"; type: WorkType; area: WorkArea }
  | { step: "choose_work"; type: WorkType; options: WorkArea[] };

/**
 * The one group a message names for itself, as in "for work" or "in my side
 * business". A bare word is not enough ("work on the deck" names no group),
 * and two named groups are no answer at all.
 */
export function groupMentioned(
  text: string,
  groups: readonly { id: string; name: string }[],
): string | null {
  const named = groups.filter((group) => {
    const name = group.name
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    if (!name) return false;
    return new RegExp(
      `(?:\\b(?:for|in|at|under|to|on)\\s+(?:my\\s+|the\\s+|our\\s+)?${name}\\b)|(?:\\b${name}\\s+group\\b)`,
      "i",
    ).test(text);
  });
  return named.length === 1 ? named[0]!.id : null;
}

/** F1 intake: group first, then kind, then link. Never creates a duplicate silently. */
export function intake(input: {
  text: string;
  fileNames?: string[];
  readable?: boolean;
  groupId: string | null;
  groups: Group[];
  areas: WorkArea[];
}): IntakeStep {
  const kind = classifyMaterial(input);
  if (kind.kind === "unreadable") return { step: "unreadable" };
  if (input.groupId === null && input.groups.length !== 1)
    return { step: "ask_group" };
  const groupId = input.groupId ?? input.groups[0]!.id;
  if (kind.kind === "record")
    return { step: "save_record", type: kind.type, ask: "link" };
  if (kind.kind === "objective") return { step: "define_objective" };
  if (kind.kind === "execution") return { step: "route_execution" };
  const inferred = inferWorkArea(input.text, input.areas, groupId);
  if (inferred.confident)
    return { step: "file_work", type: kind.type, area: inferred.confident };
  return { step: "choose_work", type: kind.type, options: inferred.options };
}

/** Library › Needs linking and the single Home line when more than ten pile up (Q79). */
export function needsLinking(records: SupportingRecord[]) {
  const pending = records.filter(
    (record) =>
      record.linkage === "link_later" || record.linkage === "unresolved",
  );
  return {
    pending,
    homeLine:
      pending.length > 10
        ? `${pending.length} records are waiting to be linked`
        : null,
  };
}

/**
 * A short name for new work from what the user typed:
 * "Create a product called Agentic Platform" → "Agentic Platform".
 */
export function nameFromRequest(text: string, fallback = "Untitled") {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  const quoted =
    /\b(?:called|named)\s+(?:called\s+|named\s+)?["“]([^"”]+)["”]/i.exec(line);
  const named =
    quoted ??
    /\b(?:called|named)\s+(?:called\s+|named\s+)?(.+?)\s*$/i.exec(line);
  // Only the name: what follows it ("it is for work and has a deadline…")
  // describes the work and is not part of what it is called.
  const afterName =
    /\s*(?:[,;:.!?](?:\s|$)|\s+[-–—]\s+|\s+(?:it\s+is|it['’]s|it\s+has|and\s+it|and\s+has|that\s+is|that\s+has|which|with\s+an?|due\s|by\s+(?:next|the|end)|for\s+(?:work|my|the|our|a)\b|in\s+(?:my|the|our)\b|there\s+is|there\s+are)\b)/i;
  const only = (value: string) =>
    quoted ? value : (value.split(afterName)[0] ?? value);
  const stripped = (named ? only(named[1]!) : line)
    .replace(
      /^(?:please\s+)?(?:create|start|track|add|open|begin|set up|make|plan)\s+(?:an?\s+|the\s+|my\s+)?(?:new\s+)?(?:product|project|task|rfp|delivery project|client project)\b\s*(?:for|from|about|on|to|:|-|–)?\s*/i,
      "",
    )
    .replace(/^(?:i have an idea|idea|problem)\s*[:\-–]\s*/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
  const name = stripped || line || fallback;
  return name.length > 80 ? name.slice(0, 77).trimEnd() + "…" : name;
}
