// What Amun tells Firstmate when the owner does something on a screen.
//
// Owner's rule (20 November 2026): almost every interaction in Amun goes to
// Firstmate as a prompt saying what was done and what the card held, so
// Firstmate decides what follows. Moving between screens tells it nothing.
//
// Every work command has one entry in `noticeRules`. The compiler refuses a
// command with no entry, so a new action cannot skip this decision:
//   tell  - the owner's action; Firstmate is told, with the card.
//   own   - it already reaches Firstmate another way (named in the reason).
//   local - Amun's own bookkeeping; the reason says why Firstmate is not told.
import type { WorkCommand, WorkSnapshot } from "../../../contracts/src/work.ts";

type Action = WorkCommand["action"];
type Of<A extends Action> = Extract<WorkCommand, { action: A }>;

/** The workspace before and after the command, and the id it created. */
export interface NoticeLook {
  before: WorkSnapshot | null;
  after: WorkSnapshot | null;
  ref: string | null;
}

export interface FirstmateNotice {
  /** What the owner did, in plain words, ending without a full stop. */
  what: string;
  /** What the card held, as records from the workspace. */
  card: Record<string, unknown>[];
  /** The work it belongs to, when there is one: where a reply is kept. */
  workAreaId: string | null;
}

type Told = { what: string; ids?: (string | null | undefined)[] } | null;
type Rule<A extends Action> =
  | { tell: (command: Of<A>, look: Look) => Told }
  | { own: string }
  | { local: string };

const LONG = 1200;
const trim = (value: unknown): unknown => {
  if (typeof value === "string")
    return value.length > LONG ? value.slice(0, LONG) + " …" : value;
  if (Array.isArray(value)) return value.slice(0, 40).map(trim);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, trim(inner)]),
    );
  return value;
};

/** Reads names and records out of the two snapshots. */
class Look {
  constructor(readonly at: NoticeLook) {}
  private each(): WorkSnapshot[] {
    return [this.at.after, this.at.before].filter(
      (snapshot): snapshot is WorkSnapshot => snapshot !== null,
    );
  }
  /** Every record with this id, newest state first, tagged with its list. */
  records(id: string): Record<string, unknown>[] {
    for (const snapshot of this.each()) {
      const found: Record<string, unknown>[] = [];
      for (const [list, rows] of Object.entries(snapshot)) {
        // Messages and chats are conversation, not a card.
        if (list === "messages" || list === "chats" || !Array.isArray(rows))
          continue;
        for (const row of rows)
          if (
            row &&
            typeof row === "object" &&
            (row as { id?: unknown }).id === id
          )
            found.push({ list, ...(trim(row) as object) });
      }
      if (found.length) return found;
    }
    return [];
  }
  private row(list: keyof WorkSnapshot, id: string) {
    for (const snapshot of this.each()) {
      const rows = snapshot[list];
      if (!Array.isArray(rows)) continue;
      const found = (rows as { id?: unknown }[]).find((row) => row?.id === id);
      if (found) return found as Record<string, unknown>;
    }
    return null;
  }
  field(list: keyof WorkSnapshot, id: string, key: string): string | null {
    const value = this.row(list, id)?.[key];
    return typeof value === "string" && value ? value : null;
  }
  area(id: string | null | undefined): string {
    const name = id ? this.field("areas", id, "name") : null;
    return name ? `“${name}”` : "a piece of work";
  }
  group(id: string | null | undefined): string {
    const name = id ? this.field("groups", id, "name") : null;
    return name ? `“${name}”` : "a group";
  }
  /** The work a record belongs to, when it says so. */
  areaOf(id: string | null | undefined): string | null {
    if (!id) return null;
    for (const record of this.records(id)) {
      if (record.list === "areas") return id;
      for (const key of ["workAreaId", "areaId"])
        if (typeof record[key] === "string") return record[key] as string;
    }
    return null;
  }
}

const day = (stamp: string | null | undefined) =>
  stamp ? stamp.slice(0, 10) : "no date";
const said = (text: string) => `“${text.trim().slice(0, 400)}”`;
const changes = (patch: Record<string, unknown>) =>
  Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(
      ([key, value]) =>
        `${key} → ${value === null || value === "" ? "none" : String(value)}`,
    )
    .join("; ");

const chats =
  "Chat housekeeping. Each message already tells Firstmate which chat and folder it belongs to.";

export const noticeRules: { [A in Action]: Rule<A> } = {
  // ── Amun's own bookkeeping ──
  snapshot: { local: "Reads the workspace; nothing changes." },
  seen: { local: "Marks the screen as looked at." },
  "touch-area": { local: "Opening a piece of work is moving around." },
  setup: { local: "The owner's display choices for Amun itself." },
  "finish-setup": {
    local:
      "First-run setup. Team picks are sent to Firstmate once, separately.",
  },
  intake: {
    local: "Files a typed message; the message itself goes to Firstmate.",
  },
  message: { local: "The conversation itself; the owner's words are sent." },
  "settle-card": { local: "Updates a card already answered." },
  attention: { local: "Raised by Amun or by Firstmate, not by the owner." },
  "navigation-activity": {
    local: "The navigation queue sends the read prompt separately.",
  },
  activity: { local: "Progress of a turn Firstmate is already running." },
  "agent-status": { local: "Reported from Firstmate's own crew." },
  "record-results": { local: "What publishing returned; no owner choice." },
  "external-change": { local: "A teammate's change read from the tracker." },
  "council-session": {
    local: "Recorded by the Council, which the Chair runs with Firstmate.",
  },
  "fork-chat": { local: chats },
  "delete-chat": { local: chats },
  "new-chat": { local: chats },
  "rename-chat": { local: chats },
  "archive-chat": { local: chats },
  "pin-chat": { local: chats },
  "read-messages": { local: "Reading a reply is the owner's own bookkeeping." },
  "suggest-chat-title": { own: "Firstmate suggested this title itself." },
  "move-chat": { local: chats },
  "register-request": {
    own: "The owner's message carries the reference to Firstmate.",
  },
  "request-report": { own: "Firstmate reported it itself." },
  "apply-reply": { own: "Firstmate's own reply." },
  "record-firstmate-reply": { own: "Firstmate's own reply." },
  "request-change": {
    own: "Sent to Firstmate as the owner's own request to change project.",
  },
  "request-change-result": { own: "Firstmate confirmed or refused it." },
  "keep-here": { local: chats },

  // ── Already sent to Firstmate another way ──
  "add-agent": { own: "Sent as a team request (teamRequest)." },
  "toggle-agent": { own: "Sent as a team request (teamRequest)." },
  "edit-agent": { own: "Sent as a team request (teamRequest)." },

  // ── The owner's actions ──
  "add-group": {
    tell: (c) => ({ what: `added a group named “${c.name}”` }),
  },
  "rename-group": {
    tell: (c) => ({
      what: `renamed a group to “${c.name}”`,
      ids: [c.groupId],
    }),
  },
  "set-route": {
    tell: (c, look) => ({
      what: `chose ${c.tracker} as the place ${c.condition ?? "all"} work in ${look.group(c.groupId)} is tracked`,
      ids: [c.groupId],
    }),
  },
  "create-area": {
    tell: (c, look) => ({
      what: `created the ${c.type} “${c.name}”`,
      ids: [look.at.ref],
    }),
  },
  "update-area": {
    tell: (c, look) => ({
      what: `changed ${look.area(c.areaId)}: ${changes(c.patch)}`,
      ids: [c.areaId],
    }),
  },
  "delete-area": {
    tell: (c, look) => ({
      what: `deleted ${look.area(c.areaId)}`,
      ids: [c.areaId],
    }),
  },
  "convert-task": {
    tell: (c, look) => ({
      what: c.convert
        ? `turned the task ${look.area(c.areaId)} into a project`
        : `chose to keep ${look.area(c.areaId)} as a task`,
      ids: [c.areaId],
    }),
  },
  "relate-areas": {
    tell: (c, look) => ({
      what: `linked ${look.area(c.fromId)} to ${look.area(c.toId)} (${c.relation})`,
      ids: [c.fromId, c.toId],
    }),
  },
  "save-record": {
    tell: (c, look) => ({
      what: `saved a ${c.type} record titled “${c.title}”`,
      ids: [look.at.ref],
    }),
  },
  "link-record": {
    tell: (c, look) => ({
      what:
        c.choice === "link"
          ? `linked a record to ${c.workAreaIds.map((id) => look.area(id)).join(", ") || "work"}`
          : c.choice === "later"
            ? "chose to link a record later"
            : "chose never to link a record",
      ids: [c.recordId, ...c.workAreaIds],
    }),
  },
  "grant-cross-group": {
    tell: (c, look) => ({
      what: `allowed ${look.group(c.targetGroupId)} to use ${said(c.information)} from ${look.group(c.sourceGroupId)}, for ${said(c.purpose)}`,
      ids: [look.at.ref],
    }),
  },
  "revoke-grant": {
    tell: (c) => ({
      what: "withdrew a permission to use another group's information",
      ids: [c.grantId],
    }),
  },
  "save-objective": {
    tell: (c, look) => ({
      what: `saved the objective “${c.metric}”`,
      ids: [c.objectiveId ?? look.at.ref, ...c.workAreaIds],
    }),
  },
  "add-permission": {
    tell: (c, look) => ({
      what: `gave a standing permission in ${look.group(c.groupId)}: ${c.permit} on ${c.destination}`,
      ids: [look.at.ref],
    }),
  },
  "revoke-permission": {
    tell: (c) => ({
      what: "withdrew a standing permission",
      ids: [c.permissionId],
    }),
  },
  "rule-case": {
    tell: (c) => ({
      what: `decided ${said(c.resolution)} for the situation “${c.situation}”`,
    }),
  },
  "decide-rule": {
    tell: (c) => ({
      what:
        c.choice === "remember"
          ? `asked to always do this for “${c.situation}”: ${said(c.resolution)}`
          : c.choice === "never"
            ? `said never to make a rule for “${c.situation}”`
            : `put off making a rule for “${c.situation}”`,
    }),
  },
  "revoke-rule": {
    tell: (c) => ({ what: "removed a standing rule", ids: [c.ruleId] }),
  },
  "start-delivery": {
    tell: (c, look) => ({
      what: `switched ${look.area(c.workAreaId)} from its checklist to stories and sprints; its checklist tasks are now stories`,
      ids: [c.workAreaId],
    }),
  },
  "set-story-status": {
    tell: (c) => ({
      what: `set a story kept in Amun to ${c.status.replace("_", " ")}`,
      ids: [c.itemId],
    }),
  },
  "link-delivery": {
    tell: (c) => ({
      what: `${c.linked ? "linked" : "unlinked"} ${c.kind === "release_story" ? "a story and a release" : c.kind === "roadmap_release" ? "a roadmap item and a release" : "a roadmap item and its requirements"}`,
      ids: [c.fromId, c.toId],
    }),
  },
  "close-out-release": {
    tell: (c) => ({
      what: "closed out a release that is Verified live: its stories kept in Amun are Done; stories in a tool still need an approved plan to close there",
      ids: [c.releaseId],
    }),
  },
  "mark-delivered": {
    tell: (c, look) => ({
      what: `marked the requirements of ${look.area(c.workAreaId)} Delivered`,
      ids: [c.workAreaId],
    }),
  },
  "propose-plan": {
    tell: (c, look) => ({
      what: `drew up a ${c.planKind.replace("_", " ")} plan for ${c.destination}: ${said(c.summary)} (${c.items.length} items). It waits for the captain's own approval and nothing is published yet`,
      ids: [look.at.ref, c.workAreaId],
    }),
  },
  "update-plan": {
    tell: (c) => ({
      what: `edited the items of a plan before approving it (${c.items.length} items now)`,
      ids: [c.planId],
    }),
  },
  "approve-plan": {
    tell: (c) => ({
      what: c.itemIds
        ? `approved ${c.itemIds.length} items of a plan; Amun is publishing exactly those`
        : "approved a plan; Amun is publishing exactly that list",
      ids: [c.planId],
    }),
  },
  "request-changes": {
    tell: (c) => ({
      what: `asked for changes to a plan${c.note ? `: ${said(c.note)}` : ""}`,
      ids: [c.planId],
    }),
  },
  "resolve-attention": {
    tell: (c, look) => {
      // Firstmate's own holds are answered through holds.answer.
      if (c.attentionId.startsWith("hold:")) return null;
      const ref = look.field("attention", c.attentionId, "ref");
      // "Where does this go?" is settled by sending the held message itself.
      if (ref?.startsWith("move:")) return null;
      const title = look.field("attention", c.attentionId, "title");
      const item = title ? `“${title}”` : "an item under Needs your attention";
      return {
        what:
          c.resolution === "done"
            ? `marked ${item} as done`
            : c.resolution === "snooze"
              ? `put ${item} off${c.until ? ` until ${c.until}` : ""}`
              : c.resolution === "accept"
                ? `accepted ${item}`
                : `answered ${item}: ${said(c.answer ?? "")}`,
        ids: [c.attentionId, look.areaOf(c.attentionId)],
      };
    },
  },
  "raise-blocker": {
    tell: (c, look) => ({
      what: `recorded a blocker on ${look.area(c.areaId)}: “${c.title}”${c.owner ? `, owned by ${c.owner}` : ""}`,
      ids: [look.at.ref, c.areaId],
    }),
  },
  "draft-blocker-message": {
    local:
      "Firstmate receives the request in the originating sprint conversation.",
  },
  "record-blocker-message": {
    tell: (c) => ({
      what:
        c.disposition === "manual"
          ? "confirmed a blocker message was sent manually"
          : "copied a blocker message; delivery remains unconfirmed",
      ids: [c.areaId, c.blockerId, c.ref],
    }),
  },
  "link-blocker-story": {
    tell: (c) => ({
      what:
        "linked blocker " +
        c.blockerId +
        " to story " +
        c.storyId +
        " in sprint " +
        c.sprintId,
      ids: [c.areaId, c.blockerId, c.sourceId, c.sprintId, c.storyId],
    }),
  },
  "set-blocker-owner": {
    tell: (c) => ({
      what: c.owner
        ? `named ${c.owner} as the one to clear a blocker`
        : "cleared who owns a blocker",
      ids: [c.blockerId],
    }),
  },
  "resolve-blocker": {
    tell: (c) => ({ what: "marked a blocker as cleared", ids: [c.blockerId] }),
  },
  reminder: {
    tell: (c, look) => ({
      what: `asked to be reminded: ${said(c.text)}. Amun keeps the reminder and shows it when it is due`,
      ids: [look.at.ref, c.workAreaId],
    }),
  },
  "finish-reminder": {
    tell: (c) => ({
      what: "marked a reminder as done",
      ids: [c.reminderId],
    }),
  },
  "snooze-reminder": {
    tell: (c) => ({ what: "put a reminder off", ids: [c.reminderId] }),
  },
  "cancel-reminder": {
    tell: (c) => ({ what: "cancelled a reminder", ids: [c.reminderId] }),
  },
  "save-rfp": {
    tell: (c, look) => ({
      what: c.areaId
        ? `changed the RFP ${look.area(c.areaId)}`
        : `started tracking the RFP “${c.name}”${c.client ? ` for ${c.client}` : ""}, due ${day(c.deadline)}`,
      ids: [c.areaId ?? look.at.ref],
    }),
  },
  "move-rfp": {
    tell: (c, look) => ({
      what: `moved the RFP ${look.area(c.areaId)} to ${c.stage.replace(/_/g, " ")}${c.lossReason ? `, reason: ${said(c.lossReason)}` : ""}`,
      ids: [c.areaId],
    }),
  },
  "rfp-readiness": {
    tell: (c, look) => ({
      what: `ticked the hand-over checks for the RFP ${look.area(c.areaId)}: proposal signed ${c.proposalSigned ? "yes" : "no"}, BRD approved ${c.brdApproved ? "yes" : "no"}`,
      ids: [c.areaId],
    }),
  },
  "handoff-rfp": {
    tell: (c, look) => ({
      what: `handed the won RFP ${look.area(c.areaId)} to delivery`,
      ids: [c.areaId, look.at.ref],
    }),
  },
  "update-rfp": {
    tell: (c, look) => ({
      what: `changed the RFP ${look.area(c.areaId)}: ${changes(c.patch)}`,
      ids: [c.areaId],
    }),
  },
  "hold-rfp": {
    tell: (c, look) => ({
      what: c.held
        ? `put the RFP ${look.area(c.areaId)} on hold${c.reason ? `: ${said(c.reason)}` : ""}`
        : `took the RFP ${look.area(c.areaId)} off hold`,
      ids: [c.areaId],
    }),
  },
  "add-rfp-summary": {
    tell: (c, look) => ({
      what: `wrote a summary on the RFP ${look.area(c.areaId)}: ${said(c.text)}`,
      ids: [c.areaId],
    }),
  },
  "save-roadmap-item": {
    tell: (c, look) => ({
      what: `${c.itemId ? "changed" : "added"} the roadmap item “${c.title}” for ${look.area(c.workAreaId)} (${c.horizon})`,
      ids: [c.itemId ?? look.at.ref, c.workAreaId],
    }),
  },
  "move-roadmap-item": {
    tell: (c) => ({
      what: `moved a roadmap item to ${c.horizon}`,
      ids: [c.itemId],
    }),
  },
  "save-sprint": {
    tell: (c, look) => ({
      what: `${c.sprintId ? "changed" : "drafted"} the sprint “${c.name}” for ${look.area(c.workAreaId)}, ${day(c.start)} to ${day(c.end)}, ${c.stories.length} stories in and ${c.out.length} out`,
      ids: [c.sprintId ?? look.at.ref, c.workAreaId],
    }),
  },
  "edit-sprint-draft": {
    tell: (c) => ({
      what: "updated local draft details for " + c.name,
      ids: [c.sprintId, c.workAreaId],
    }),
  },
  "move-sprint-story": {
    tell: (c) => ({
      what: `moved story ${c.storyId} ${c.list === "out" ? "out of" : "into"} a sprint${c.owner ? `, for ${c.owner}` : ""}`,
      ids: [c.sprintId],
    }),
  },
  "calendar-exception": {
    tell: (c) => ({
      what: `marked ${day(c.date)} as a day off: “${c.label}”`,
    }),
  },
  "save-output": {
    tell: (c, look) =>
      // A draft Firstmate or its agents wrote is not news to Firstmate, and
      // an empty new page says nothing yet.
      c.author !== "owner" || (!c.outputId && !c.body)
        ? null
        : {
            what: `${c.outputId ? "edited" : "started"} the ${c.type} “${c.title}”`,
            ids: [c.outputId ?? look.at.ref, ...c.workAreaIds],
          },
  },
  "restore-output-version": {
    tell: (c) => ({
      what: `brought back version ${c.versionNumber} of a document`,
      ids: [c.outputId],
    }),
  },
  "approve-output": {
    tell: (c) => ({
      what: c.approved
        ? "approved a document"
        : "withdrew the approval of a document",
      ids: [c.outputId],
    }),
  },
  "record-acceptance": {
    tell: (c) => ({
      what:
        (c.decision === null
          ? "cleared the acceptance decision on a document"
          : `recorded acceptance on a document: ${c.decision.replace("_", " ")}`) +
        (c.reason ? `, reason: ${said(c.reason)}` : ""),
      ids: [c.outputId],
    }),
  },
  "record-decision": {
    tell: (c, look) => ({
      what: `recorded a decision: “${c.what}”${c.outcome ? `, outcome: ${said(c.outcome)}` : ""}`,
      ids: [c.decisionId ?? look.at.ref, c.workAreaId],
    }),
  },
  "scope-answer": {
    tell: (c, look) => ({
      what: `answered the out-of-scope request “${c.item}” on ${look.area(c.workAreaId)}: ${c.answer.replace(/_/g, " ")}`,
      ids: [c.workAreaId],
    }),
  },
  "save-finding": {
    tell: (c) => ({
      what: `noted a finding: ${said(c.text)}`,
      ids: [c.recordId, ...c.workAreaIds],
    }),
  },
  "defer-finding": {
    tell: (c, look) => ({
      what: `put a finding aside for ${look.area(c.workAreaId)}`,
      ids: [c.findingId, c.workAreaId],
    }),
  },
  "record-claim": {
    tell: (c) => ({
      what: `saved a fact: ${c.key} is ${said(c.value)} (from ${c.source})`,
    }),
  },
  "correct-claim": {
    tell: (c) => ({
      what: `corrected a remembered fact to ${said(c.value)}`,
      ids: [c.claimId],
    }),
  },
  "forget-claim": {
    tell: (c) => ({
      what: "asked Amun to forget a remembered fact",
      ids: [c.claimId],
    }),
  },
  "resolve-claim": {
    tell: (c) => ({
      what: `settled two versions of a fact by keeping the ${c.keep === "current" ? "one Amun already had" : "new one"}`,
      ids: [c.attentionId],
    }),
  },
};

/**
 * The note for one command, or null when Firstmate is not told (see the
 * reason on its rule). `command` must already be a valid work command.
 */
export function firstmateNotice(
  command: WorkCommand,
  at: NoticeLook,
): FirstmateNotice | null {
  const rule = noticeRules[command.action] as Rule<Action>;
  if (!("tell" in rule)) return null;
  const look = new Look(at);
  const told = (rule.tell as (c: WorkCommand, look: Look) => Told)(
    command,
    look,
  );
  if (!told) return null;
  const ids = [...new Set((told.ids ?? []).filter((id): id is string => !!id))];
  const card = ids.flatMap((id) => look.records(id));
  // Leaving a field as it was changes nothing, so there is nothing to tell.
  if (at.before && at.after) {
    const only = (snapshot: WorkSnapshot) => {
      const one = new Look({ before: null, after: snapshot, ref: null });
      return ids.flatMap((id) => one.records(id));
    };
    const was = only(at.before);
    const is = only(at.after);
    if (was.length && is.length && JSON.stringify(was) === JSON.stringify(is))
      return null;
  }
  let workAreaId: string | null = null;
  for (const id of ids) {
    workAreaId = look.areaOf(id);
    if (workAreaId) break;
  }
  return { what: told.what, card, workAreaId };
}

/** Firstmate's "nothing for the captain" answer to a note. */
export function isNoted(reply: string): boolean {
  return /^(?:captain[,.!]?\s*)?(?:noted|understood|acknowledged|aye(?:,? aye)?)?[.!]?$/i.test(
    reply.trim(),
  );
}

const CARD_LIMIT = 6000;

/** The one prompt that carries one or more notes to Firstmate. */
export function noticePrompt(notices: FirstmateNotice[]): string {
  const lines = [
    notices.length === 1
      ? "A note from Amun, not typed by the captain. The captain did this on a screen in Amun:"
      : `Notes from Amun, not typed by the captain. The captain did these ${notices.length} things on screens in Amun, in this order:`,
  ];
  notices.forEach((notice, index) => {
    lines.push(
      "",
      `${notices.length === 1 ? "" : `${index + 1}. `}The captain ${notice.what}.`,
    );
    if (notice.card.length) {
      const card = JSON.stringify(notice.card, null, 1);
      lines.push(
        "What the card held (Amun's record after the change):",
        card.length > CARD_LIMIT ? card.slice(0, CARD_LIMIT) + "\n…" : card,
      );
    }
  });
  lines.push(
    "",
    "Amun has already saved this in its own records; do not repeat the change in Amun and do not raise it again as a question.",
    "Do whatever follows from it your usual way: update what you track, and tell, redirect or stop the crew member whose work it touches. You stay the coordinator; real work goes to the crew, not to you.",
    "If the captain needs to know or decide something because of it, say so in one or two plain lines. If nothing follows, reply with exactly: Noted.",
  );
  return lines.join("\n");
}
