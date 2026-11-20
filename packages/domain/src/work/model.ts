// UX rebuild conceptual model (Amun_UX_Rebuild_Handoff §3, reconciled §3).
// Groups scope everything; work areas, supporting records, objectives and
// execution records stay distinct. Pure logic only: no storage, no I/O.
import { reminderIntent, type ReminderIntent } from "./reminders.ts";

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
  // "Interview me" is a request to Firstmate, not interview notes to file.
  if (
    has(text, "interview", "transcript", "call notes") &&
    !/\b(?:interview|ask|question)\s+me\b/i.test(text)
  )
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
  | { step: "reminder"; intent: ReminderIntent }
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

/** A request to add, list or cancel reminders; none of them is work. */
export function isReminderRequest(text: string): boolean {
  return reminderIntent(text) !== null;
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
  const reminder = input.fileNames?.length ? null : reminderIntent(input.text);
  if (reminder) return { step: "reminder", intent: reminder };
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

/**
 * Where a message goes when it is a question or a request for Firstmate and
 * not a piece of work to file: one standing conversation per group. The owner
 * is never asked "where does this belong?" for it (owner, 18 November 2026).
 */
export const generalConversationName = "Chat with Firstmate";

const newWorkRequest =
  /^(?:please\s+)?(?:create|start|track|add|open|begin|set up|make|plan)\s+(?:an?\s+|the\s+|my\s+)?(?:new\s+)?(?:product|project|task|rfp|delivery project|client project)\b/i;
// "Create a new PRD for a new product named X": the new work is named later
// in the sentence, after what the owner wants done with it.
const newWorkLater =
  /^(?:please\s+)?(?:create|start|add|open|begin|set up|make|plan|write|draft)\b[^.\n]{0,60}?\b(?:an?\s+)?new\s+(product|project|task|rfp)\b/i;
/** True only when the message itself asks for new work of a named kind. */
export function asksForNewWork(text: string): boolean {
  const first = text.trim().split("\n")[0]?.trim() ?? "";
  return newWorkRequest.test(first) || newWorkLater.test(first);
}

/**
 * The kind and name of the new work a message asks for, when it says both
 * ("Create a new product named Atlas and interview me"). Amun then creates it
 * and opens it with the message, so Firstmate starts at once instead of the
 * owner being asked where the message belongs.
 */
export function newWorkNamed(
  text: string,
): { type: "product" | "project" | "task" | "rfp"; name: string } | null {
  const first = text.trim().split("\n")[0]?.trim() ?? "";
  if (!asksForNewWork(first)) return null;
  const kind = /\b(?:new\s+)?(product|project|task|rfp)\b/i.exec(
    first.replace(/^.*?\bnew\s+(?=(?:product|project|task|rfp)\b)/i, ""),
  );
  // A quoted name is taken whole ("Research and Development"); only an
  // unquoted one ends at "and", "to", "that" or "which".
  const quoted =
    /\b(?:named|called|name|titled)\s*[:\-]?\s*["“']([^"”'\n]{1,80})["”']/i.exec(
      first,
    );
  const named =
    quoted ??
    /\b(?:named|called|name|titled)\s*[:\-]?\s*([^"”'.,;\n]{1,80}?)\s*(?:[.,;\n]|\band\b|\bto\b|\bthat\b|\bwhich\b|$)/i.exec(
      first,
    );
  // "Create a new project for Gitex to be high priority": the name follows
  // "for". Only a proper name counts, so "a product for the pilot" names nothing.
  const forName =
    /\b(?:product|project|task|rfp)\s+for\s+(?!(?:the|a|an|my|our|your|this|that|these|those|me|us|it|them|him|her)\b)([A-Z0-9][^"”'.,;\n]{0,79}?)\s*(?:[.,;\n]|\band\b|\bto\b|\bthat\b|\bwhich\b|\bwith\b|\bby\b|\bon\b|\bdue\b|\bready\b|$)/.exec(
      first,
    );
  const name = (named?.[1] ?? forName?.[1])?.trim();
  if (!kind || !name) return null;
  return {
    type: kind[1]!.toLowerCase() as "product" | "project" | "task" | "rfp",
    name,
  };
}

export type WorkPriority = "low" | "medium" | "high" | "urgent";

/** The priority a message states in so many words; null when it states none. */
export function statedPriority(text: string): WorkPriority | null {
  const found =
    /\b(low|medium|normal|high|top|urgent|critical)[\s-]+priority\b/i.exec(
      text,
    ) ??
    /\bpriority\s*(?:is|of|:|=)?\s*(low|medium|normal|high|top|urgent|critical)\b/i.exec(
      text,
    );
  if (!found) return /\burgent\b/i.test(text) ? "urgent" : null;
  const word = found[1]!.toLowerCase();
  if (word === "normal") return "medium";
  if (word === "top" || word === "critical") return "urgent";
  return word as WorkPriority;
}

const monthWord =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

/**
 * The calendar day a message names as its deadline ("ready on Dec 6",
 * "by 6 December 2026", "due 2026-12-06"), as YYYY-MM-DD. A day with no year
 * is the next one that has not passed, counted from `today` (the owner's own
 * calendar day). Null when no day is named or the day does not exist: a
 * deadline is never guessed.
 */
export function statedDueDate(text: string, today: string): string | null {
  const day = (year: number, month: number, date: number) => {
    const made = new Date(Date.UTC(year, month, date));
    if (
      made.getUTCFullYear() !== year ||
      made.getUTCMonth() !== month ||
      made.getUTCDate() !== date
    )
      return null;
    return made.toISOString().slice(0, 10);
  };
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return day(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const monthFirst = new RegExp(
    `\\b${monthWord}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4})\\b)?`,
    "i",
  ).exec(text);
  const dayFirst = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${monthWord}\\b\\.?(?:,?\\s+(\\d{4})\\b)?`,
    "i",
  ).exec(text);
  const parts = monthFirst
    ? { month: monthFirst[1]!, date: monthFirst[2]!, year: monthFirst[3] }
    : dayFirst
      ? { month: dayFirst[2]!, date: dayFirst[1]!, year: dayFirst[3] }
      : null;
  if (!parts || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const month = monthNames.indexOf(parts.month.slice(0, 3).toLowerCase());
  const date = Number(parts.date);
  if (parts.year) return day(Number(parts.year), month, date);
  const thisYear = Number(today.slice(0, 4));
  const soon = day(thisYear, month, date);
  if (soon && soon >= today) return soon;
  return day(thisYear + 1, month, date);
}

/** Two names for the same folder: case, spaces, dashes and dots do not count. */
export function sameWorkName(a: string, b: string): boolean {
  const plain = (value: string) =>
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "");
  const left = plain(a);
  return left.length > 0 && left === plain(b);
}

export interface NewWorkRequest {
  type: "product" | "project" | "task" | "rfp";
  name: string;
  priority: WorkPriority | null;
  /** YYYY-MM-DD, only when the message names a day. */
  dueDate: string | null;
}

/**
 * Where an explicit request for new work goes, decided by Amun's own rules
 * before anything is sent (owner, 20 November 2026). No model is asked.
 *
 * - `none`: not a named request for new work; the message goes where it was typed.
 * - `create`: make the folder and file the message as its first chat.
 * - `existing`: a folder of that name is already there (archived ones too); ask.
 * - `offer_move`: typed inside another folder; hold it and ask move or keep.
 */
export type NewWorkRoute =
  | { route: "none" }
  | { route: "create"; request: NewWorkRequest }
  | { route: "existing"; request: NewWorkRequest; areaId: string }
  | {
      route: "offer_move";
      request: NewWorkRequest;
      /** The folder of that name, when there is one. */
      areaId: string | null;
    };

export function routeNewWork(input: {
  text: string;
  today: string;
  /** Every folder that is not deleted, archived ones included. */
  areas: readonly { id: string; name: string }[];
  /** The folder the message was typed in; null for General, Home and Portfolio. */
  inside: { id: string; keptHere: readonly string[] } | null;
}): NewWorkRoute {
  const named = newWorkNamed(input.text);
  if (!named) return { route: "none" };
  const request: NewWorkRequest = {
    ...named,
    priority: statedPriority(input.text),
    dueDate: statedDueDate(input.text, input.today),
  };
  const twin = input.areas.find((area) => sameWorkName(area.name, named.name));
  if (input.inside) {
    // The owner already said this name belongs here, or it is this folder.
    if (
      twin?.id === input.inside.id ||
      input.inside.keptHere.some((kept) => sameWorkName(kept, named.name))
    )
      return { route: "none" };
    return { route: "offer_move", request, areaId: twin?.id ?? null };
  }
  if (twin) return { route: "existing", request, areaId: twin.id };
  return { route: "create", request };
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
    /\s*(?:[,;:.!?](?:\s|$)|\s+[-–—]\s+|\s+(?:it\s+is|it['’]s|it\s+has|and\s+it|and\s+has|that\s+is|that\s+has|which|with\s+an?|due\s|by\s+(?:next|the|end)|for\s+(?:work|my|the|our|a|testing|tests?|qa|demo)\b|in\s+(?:my|the|our)\b|there\s+is|there\s+are)\b)/i;
  // An identifier-like name ("QA-20261114-RFP for testing") ends at its token.
  const identifier =
    /^([^\s"“”]*[-_\d][^\s"“”]*?)[,;:.!?]?\s+(?:for|in|to|as|on|so|because|that|which|with|and|where|when|it|the)\b/i;
  const only = (value: string) =>
    quoted
      ? value
      : (identifier.exec(value)?.[1] ?? value.split(afterName)[0]) || value;
  const lead =
    /^(?:please\s+)?(?:create|start|track|add|open|begin|set up|make|plan)\s+(?:an?\s+|the\s+|my\s+)?(?:new\s+)?(?:product|project|task|rfp|delivery project|client project)\b\s*(?:for|from|about|on|to|:|-|–)?\s*/i;
  const afterLead = lead.test(line) ? line.replace(lead, "") : null;
  const leadingQuote =
    afterLead === null ? null : /^["“]([^"”]+)["”]/.exec(afterLead);
  // Without a stated name, the first sentence stands in, never the whole message.
  const firstSentence = (value: string) =>
    value.split(/[.!?](?:\s|$)/)[0]?.trim() ?? "";
  const shortened = (value: string) => {
    if (value.length <= 60) return value;
    const cut = value.slice(0, 60);
    const space = cut.lastIndexOf(" ");
    return space > 20 ? cut.slice(0, space).trimEnd() : value;
  };
  const candidate = named
    ? only(named[1]!)
    : leadingQuote
      ? leadingQuote[1]!
      : afterLead !== null
        ? only(firstSentence(afterLead) || afterLead)
        : shortened(firstSentence(line) || line);
  const stripped = candidate
    .replace(/^(?:i have an idea|idea|problem)\s*[:\-–]\s*/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
  const name = stripped || line || fallback;
  return name.length > 80 ? name.slice(0, 77).trimEnd() + "…" : name;
}

const unknownValue =
  /^(?:not\s+(?:yet\s+)?(?:known|assigned|set|decided)|unknown|unassigned|tbd|none|n\/a)\b/i;

/**
 * What an RFP request states, and nothing more. The name is the quoted or
 * "named/called" name; the client, deadline and group are filled only when the
 * text gives them outright ("The client is …", "due …", "in <known group>").
 * "not yet known" and "unknown" stay empty, and nothing is guessed.
 */
export function rfpFromRequest(
  text: string,
  groups: readonly { id: string; name: string }[] = [],
) {
  const body = text.replace(/^\s*(?:please\s+)?track an rfp:?\s*/i, "").trim();
  const first = body.split("\n")[0] ?? body;
  const sentenceName = /\b(?:called|named)\b/i.test(first);
  const stated = first.replace(/,?\s*\bdue\s+.+$/i, "").trim() || first;
  const name = nameFromRequest("Track an RFP " + stated, "");
  const fact = (label: RegExp) => {
    const value = label.exec(body)?.[1]?.trim();
    return value && !unknownValue.test(value) ? value : null;
  };
  const client = sentenceName
    ? fact(/\bclient\s+(?:is|:)\s+([^.;\n]+)/i)
    : (/^(?:for|from)\s+(.+)$/i.exec(stated)?.[1]?.trim() ?? null);
  const due = fact(/\bdue\s+(?:on\s+)?([^.;\n]+)/i);
  const place =
    /\bin\s+(?:the\s+)?([^.,;\n]+?)(?:\s+group)?\s*(?:[.,;]|\n|$)/gi;
  let groupId: string | null = null;
  for (const match of body.matchAll(place)) {
    const found = groups.filter(
      (group) => group.name.toLowerCase() === match[1]!.trim().toLowerCase(),
    );
    if (found.length === 1) groupId = found[0]!.id;
  }
  return { name, client, due, groupId };
}

const monthNames = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

// A real calendar day at 00:00Z, or null for something like 31 February.
function utcDay(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month &&
    date.getUTCDate() === day
    ? date
    : null;
}

function deadlineFrom(text: string, now: Date) {
  const lead = String.raw`\b(?:deadline|due)(?:\s+date)?\s*(?:is|:|on|by)?\s*`;
  const after = (pattern: string) => new RegExp(lead + pattern, "i").exec(text);
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const month = (name: string) =>
    monthNames.indexOf(name.slice(0, 3).toLowerCase());
  const monthWord = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
  const named = (
    dayText: string,
    monthText: string,
    yearText: string | undefined,
  ) => {
    const m = month(monthText);
    const d = Number(dayText);
    if (yearText) return utcDay(Number(yearText), m, d);
    const thisYear = utcDay(now.getUTCFullYear(), m, d);
    if (thisYear && thisYear.getTime() >= today) return thisYear;
    return utcDay(now.getUTCFullYear() + 1, m, d);
  };
  const iso = after(String.raw`(\d{4})-(\d{2})-(\d{2})\b`);
  if (iso) return utcDay(+iso[1]!, +iso[2]! - 1, +iso[3]!);
  const dayFirst = after(
    String.raw`(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?` +
      monthWord +
      String.raw`\b(?:,?\s+(\d{4})\b)?`,
  );
  if (dayFirst) return named(dayFirst[1]!, dayFirst[2]!, dayFirst[3]);
  const monthFirst = after(
    monthWord +
      String.raw`\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4})\b)?`,
  );
  if (monthFirst) return named(monthFirst[2]!, monthFirst[1]!, monthFirst[3]);
  const slash = after(String.raw`(\d{1,2})/(\d{1,2})/(\d{4})\b`);
  if (slash) return utcDay(+slash[3]!, +slash[2]! - 1, +slash[1]!);
  const within = after(String.raw`in\s+(\d{1,3})\s+days?\b`);
  if (within) return new Date(today + Number(within[1]) * 86_400_000);
  return null;
}

/**
 * The facts an RFP request states outright, read without guessing: the client
 * ("for client X", "client: X", a quoted name), the deadline (ISO, "25 November
 * 2026", "November 25, 2026", "25/11/2026" day-first, "due 17 November" as its
 * next occurrence, "due in 10 days"), and who owns what. The response owner is
 * set only by "response owner"; "RFP / account / sales owner" and a bare
 * "owner" are the account owner; "pre-sales X" is the pre-sales contact.
 * Anything missing, or said to be unknown, stays null.
 */
export function rfpDetails(text: string, now: Date = new Date()) {
  const known = (value: string | undefined) => {
    const clean = value?.trim();
    return clean && !unknownValue.test(clean) ? clean : null;
  };
  const end = String.raw`(?=\s*(?:[,.;\n]|$)|\s+(?:and|due|deadline)\b)`;
  const value = String.raw`\s*(?:is|:)?\s*["“]?([^",.;\n]+?)["”]?` + end;
  const client = known(
    /\bclient\s*(?:is|:)?\s*["“]([^"”]+)["”]/i.exec(text)?.[1] ??
      new RegExp(
        String.raw`\bclient\s*(?:is|:)?\s*([^,;\n]+?)(?=\s*(?:,|;|\n|\.(?:\s|$)|$)|\s+(?:due|deadline)\b|\s+(?:(?:rfp|response|account|sales)\s+)?owner\b)`,
        "i",
      ).exec(text)?.[1],
  );
  const find = (pattern: string) =>
    known(new RegExp(pattern + value, "i").exec(text)?.[1]);
  const deadline = deadlineFrom(text, now)?.toISOString() ?? null;
  const responseOwner = find(String.raw`\bresponse\s+owner`);
  const accountOwner =
    find(String.raw`\b(?:rfp|account|sales)\s+owner`) ??
    find(String.raw`(?<!\b(?:response|rfp|account|sales)\s)\bowner`);
  const presales = find(String.raw`\bpre-?sales(?:\s+contact)?`);
  return { client, deadline, responseOwner, accountOwner, presales };
}
