// Request references (owner, 20 November 2026). Every request the owner sends
// carries a stable, unique Amun reference. Firstmate is asked to repeat it in
// its backlog links, in every hand-off to its crew, and in its status reports
// and delivery replies. Amun links a result to a request only when the
// reference matches; it never guesses from wording or timing. Firstmate's own
// code is unchanged: the reference travels in plain words and in the amun
// blocks Firstmate already writes.

export type ReportedStatus =
  "queued" | "waiting" | "working" | "needs-decision" | "failed" | "delivered";
const statuses: readonly ReportedStatus[] = [
  "queued",
  "waiting",
  "working",
  "needs-decision",
  "failed",
  "delivered",
];

/** "amun-r-" and twelve hex digits: unique, short enough to repeat. */
export const requestRefPattern = /\bamun-r-[0-9a-f]{12}\b/g;
export function newRequestRef(random: () => string = defaultRandom): string {
  return (
    "amun-r-" +
    random()
      .replace(/[^0-9a-f]/g, "")
      .slice(0, 12)
  );
}
function defaultRandom() {
  return globalThis.crypto.randomUUID();
}
export const isRequestRef = (value: unknown): value is string =>
  typeof value === "string" && /^amun-r-[0-9a-f]{12}$/.test(value);

/** The line that starts the owner's message as Firstmate receives it. */
export const requestLine = (ref: string) => `[Amun request ${ref}]`;

/** What Firstmate is told, once per conversation, with Amun's rules. */
export const requestProtocol = [
  "Each message from the owner starts with a line [Amun request …], where … is the request's reference (amun-r- and twelve letters and digits). Keep it with the request for its whole life:",
  "- When you file or update a backlog item for it, add amun-request:<reference> to the item's links.",
  "- Put the reference in every brief you hand to a crewmate or second mate for it, and ask them to keep it in their report back to you.",
  '- When you report on it, now or in a later turn, add {"do":"report","request":"<reference>","status":"queued|waiting|working|needs-decision|failed|delivered","role":"who has it, e.g. Researcher","text":"a few plain words, e.g. gathering evidence","parts":2}; "parts" is how many documents the request will deliver, when you know. Use queued only when the work waits for a crewmate who is busy, and waiting when it waits for another result.',
  '- When you deliver a document for it, add "request":"<reference>" to the document block.',
  "- If one message holds several requests, report each part under the same reference.",
  '- When the owner asks you to move a request to another project, answer for each one with {"do":"reassigned","request":"<reference>","project":"the project\'s name","accepted":true} once it is done, or "accepted":false with the reason in "text" if it cannot be moved (for example, it already finished).',
  "- If you are not sure which request a result belongs to, leave the reference out. Never reuse a reference for different work.",
].join("\n");

export interface RequestReport {
  request: string;
  status: ReportedStatus;
  role: string;
  text: string;
  parts: number;
}
export interface RequestMove {
  request: string;
  project: string;
  accepted: boolean;
  text: string;
}
export interface RequestDocument {
  request: string | null;
  title: string;
  type: string;
  body: string;
}
const clip = (value: unknown, max: number) =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";

/**
 * The report and document blocks in a Firstmate reply, and the reply with
 * every amun block taken out. A block that cannot be read is dropped, never
 * shown as raw JSON.
 */
export function readRequestBlocks(reply: string): {
  visible: string;
  reports: RequestReport[];
  documents: RequestDocument[];
  moves: RequestMove[];
  /**
   * Reports with no reference, or a malformed one: never applied to a
   * request, but their words are still shown to the owner.
   */
  unmatched: RequestReport[];
  /** Every block, for the caller's other uses. */
  blocks: Record<string, unknown>[];
} {
  const reports: RequestReport[] = [];
  const documents: RequestDocument[] = [];
  const moves: RequestMove[] = [];
  const unmatched: RequestReport[] = [];
  const blocks: Record<string, unknown>[] = [];
  const visible = reply
    .replace(/```amun\s*\n([\s\S]*?)```/g, (_match, body: string) => {
      try {
        const value = JSON.parse(body) as Record<string, unknown>;
        if (!value || typeof value !== "object") return "";
        blocks.push(value);
        if (
          value.do === "report" &&
          statuses.includes(value.status as ReportedStatus)
        )
          (isRequestRef(value.request) ? reports : unmatched).push({
            request: isRequestRef(value.request) ? value.request : "",
            status: value.status as ReportedStatus,
            role: clip(value.role, 120),
            text: clip(value.text, 400),
            parts:
              Number.isInteger(value.parts) &&
              (value.parts as number) >= 0 &&
              (value.parts as number) <= 20
                ? (value.parts as number)
                : 0,
          });
        else if (
          value.do === "reassigned" &&
          isRequestRef(value.request) &&
          typeof value.accepted === "boolean"
        )
          moves.push({
            request: value.request,
            project: clip(value.project, 200),
            accepted: value.accepted,
            text: clip(value.text, 400),
          });
        else if (value.do === "document" && typeof value.title === "string")
          documents.push({
            request: isRequestRef(value.request) ? value.request : null,
            title: clip(value.title, 200),
            type: clip(value.type, 64) || "doc",
            body: typeof value.body === "string" ? value.body : "",
          });
      } catch {
        // Dropped.
      }
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { visible, reports, documents, moves, unmatched, blocks };
}

/**
 * A report that cannot be tied to a request, in plain words, so it is still
 * seen through the ordinary Firstmate channel.
 */
export function reportWords(report: RequestReport): string {
  const said: Record<ReportedStatus, string> = {
    queued: "is queued",
    waiting: "is waiting",
    working: "is in progress",
    "needs-decision": "needs your decision",
    failed: "did not finish",
    delivered: "is done",
  };
  const who = report.role ? `${report.role}: ` : "";
  return `${who}${report.text || `work ${said[report.status]}`}.`
    .replace(/\.\.$/, ".")
    .replace(/^./, (first) => first.toUpperCase());
}

/** The same report repeated (after a reconnect, say) has the same print. */
export function reportFingerprint(report: RequestReport): string {
  const text = `${report.request}|${report.status}|${report.role}|${report.text}`;
  let hash = 0;
  for (let index = 0; index < text.length; index++)
    hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
  return `${report.status}:${(hash >>> 0).toString(16)}`;
}

/**
 * The one-line status under the owner's message, in plain words from what
 * Firstmate reported. `ready` counts the documents already delivered for it.
 */
export function requestStatusLine(
  request: {
    status: "sent" | ReportedStatus;
    role: string;
    detail: string;
    changeState?: string;
  },
  ready = 0,
  expected = 0,
): string {
  const who = request.role.trim();
  const what = request.detail.trim();
  const doing =
    request.status === "queued"
      ? `Queued for ${who || "the crew"}`
      : request.status === "waiting"
        ? what
          ? `Waiting for ${what.replace(/^(for|on)\s+/i, "")}`
          : "Waiting on another result"
        : request.status === "working"
          ? who
            ? `${who} is ${what || "working on it"}`
            : what || "Being worked on"
          : request.status === "needs-decision"
            ? "Needs your decision"
            : request.status === "failed"
              ? "Didn't finish"
              : request.status === "delivered"
                ? "Ready · View reply"
                : "";
  if (request.status !== "delivered" && ready > 0) {
    const counted =
      expected > ready ? `${ready} of ${expected} ready` : `${ready} ready`;
    return doing ? `${counted} · ${doing}` : counted;
  }
  return doing;
}
