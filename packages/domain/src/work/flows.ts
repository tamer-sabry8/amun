// Process flows F3–F10 (handoff §10) as pure decisions. Each function returns
// the next step; storage and connectors act on it elsewhere.
import type { WorkType } from "./model.ts";
import { authority, type StandingPermission } from "./permissions.ts";

// ── F8 tracker routing (UC08) ────────────────────────────────────────────────
export interface RoutingRule {
  id: string;
  groupId: string;
  /** null = every kind of work in the group; otherwise a conditional route. */
  condition: "delivery" | "product" | "task" | "rfp" | null;
  tracker: string;
}
const conditionFor: Record<WorkType, NonNullable<RoutingRule["condition"]>> = {
  project: "delivery",
  product: "product",
  task: "task",
  rfp: "rfp",
};
export type Route =
  | { step: "ask_group" }
  | { step: "ask_route"; groupId: string; suggestions: string[] }
  | { step: "blocked"; tracker: string; reason: string }
  | { step: "ask_approval"; tracker: string; gate: string | null }
  | { step: "write"; tracker: string; ruleId: string };

/**
 * A conditional rule beats the group's general rule. An unreachable tracker
 * keeps its destination and reports the blocker; it never switches silently.
 * Routing chooses a destination and grants no write authority by itself.
 */
export function route(input: {
  groupId: string | null;
  workType: WorkType;
  rules: RoutingRule[];
  connected: string[];
  permissions?: StandingPermission[];
  instructed?: boolean;
}): Route {
  if (!input.groupId) return { step: "ask_group" };
  const rules = input.rules.filter((rule) => rule.groupId === input.groupId);
  const rule =
    rules.find((rule) => rule.condition === conditionFor[input.workType]) ??
    rules.find((rule) => rule.condition === null);
  if (!rule)
    return {
      step: "ask_route",
      groupId: input.groupId,
      suggestions: input.connected,
    };
  if (rule.tracker !== "amun" && !input.connected.includes(rule.tracker))
    return {
      step: "blocked",
      tracker: rule.tracker,
      reason: `${trackerName(rule.tracker)} is not connected. The work stays routed there until it is.`,
    };
  const verdict = authority(
    { action: "create", destination: rule.tracker, groupId: input.groupId },
    {
      permissions: input.permissions ?? [],
      ...(input.instructed ? { instructed: true } : {}),
    },
  );
  if (!verdict.allowed)
    return {
      step: "ask_approval",
      tracker: rule.tracker,
      gate: verdict.ask === "gate" ? verdict.gate : null,
    };
  return { step: "write", tracker: rule.tracker, ruleId: rule.id };
}
/** "Azure DevOps", or "2 destinations" when a plan's items go to several. */
export function planDestinations(plan: {
  destination: string;
  items: { fields: Record<string, unknown> }[];
}) {
  const all = new Set(
    plan.items.map((item) =>
      typeof item.fields.destination === "string" &&
      item.fields.destination.trim()
        ? item.fields.destination.trim().toLowerCase()
        : plan.destination,
    ),
  );
  return all.size === 1
    ? trackerName([...all][0]!)
    : `${all.size} destinations`;
}
export function trackerName(tracker: string) {
  return (
    {
      ado: "Azure DevOps",
      notion: "Notion",
      github: "GitHub",
      jira: "Jira",
      amun: "Amun",
    }[tracker] ?? tracker
  );
}

// ── F3 findings to approved work (UC05, UC13) ────────────────────────────────
export type FindingState =
  | "proposed"
  | "approved"
  | "written"
  | "write_failed"
  | "rejected"
  | "deferred";
export interface FindingDecision {
  findingId: string;
  workAreaId: string;
  state: FindingState;
}
/**
 * Approval for one work area never implies another. A failed write keeps the
 * approval and is not marked complete.
 */
export function decideFinding(
  decisions: FindingDecision[],
  event: {
    findingId: string;
    workAreaId: string;
    action: "approve" | "reject" | "defer" | "written" | "write_failed";
  },
): FindingDecision[] {
  const key = (decision: FindingDecision) =>
    decision.findingId === event.findingId &&
    decision.workAreaId === event.workAreaId;
  const current = decisions.find(key);
  const next: FindingState =
    event.action === "approve"
      ? "approved"
      : event.action === "reject"
        ? "rejected"
        : event.action === "defer"
          ? "deferred"
          : event.action;
  if (
    (event.action === "written" || event.action === "write_failed") &&
    current?.state !== "approved" &&
    current?.state !== "write_failed"
  )
    return decisions;
  const updated = {
    findingId: event.findingId,
    workAreaId: event.workAreaId,
    state: next,
  };
  return current
    ? decisions.map((decision) => (key(decision) ? updated : decision))
    : [...decisions, updated];
}
export const isCommitted = (state: FindingState) => state === "written";

// ── F4 task to project (UC07, Q78) ───────────────────────────────────────────
export interface TaskShape {
  milestones: number;
  people: number;
  steps: number;
  /** Shape recorded the last time the user chose "Keep as task". */
  declinedAt?: { milestones: number; people: number; steps: number } | null;
}
export function conversionSuggestion(task: TaskShape) {
  const grown =
    (task.milestones >= 2 && task.people >= 2) ||
    task.milestones >= 3 ||
    task.steps >= 8;
  if (!grown) return null;
  const declined = task.declinedAt;
  // Ask again only if it has grown much further since the user declined.
  if (
    declined &&
    task.milestones < declined.milestones * 2 &&
    task.people < declined.people * 2 &&
    task.steps < declined.steps * 2
  )
    return null;
  return {
    text: `${task.milestones} ${task.milestones === 1 ? "milestone" : "milestones"} and ${task.people} ${task.people === 1 ? "person" : "people"}. Make it a project?`,
    choices: ["Convert", "Keep as task"] as const,
    keeps: ["history", "links", "objective", "tracker"] as const,
  };
}

// ── F6 scope creep (UC15, Q77) ───────────────────────────────────────────────
export type ScopeDisposition =
  | { step: "plan" }
  | { step: "ask"; text: string; choices: readonly string[] }
  | { step: "plan"; tag: "Exception · no CR"; exception: true }
  | { step: "keep_out" };
export function scopeCheck(input: {
  inScope: boolean;
  approvedChangeRequest: boolean;
  brdVersion?: string;
  /** Earlier answer for this exact item; it is not raised again. */
  prior?: "add_anyway" | "keep_out" | null;
}): ScopeDisposition {
  if (input.inScope || input.approvedChangeRequest) return { step: "plan" };
  if (input.prior === "add_anyway")
    return { step: "plan", tag: "Exception · no CR", exception: true };
  if (input.prior === "keep_out") return { step: "keep_out" };
  return {
    step: "ask",
    text: `Outside ${input.brdVersion ?? "the approved BRD"} · no approved change request · deadline unchanged`,
    choices: [
      "Add anyway (record exception)",
      "Link a change request",
      "Keep out",
    ],
  };
}

// ── F7 RFP tracking and handoff (UC10–11, Q66) ───────────────────────────────
// Stage names are [Proposed] in the handoff and held here as data, not logic.
export const rfpStages = [
  "received",
  "in_response",
  "submitted",
  "won",
  "handed_to_delivery",
] as const;
export const rfpClosed = ["lost", "withdrawn"] as const;
export type RfpStage = (typeof rfpStages)[number] | (typeof rfpClosed)[number];
export const rfpStageLabels: Record<RfpStage, string> = {
  received: "Received",
  in_response: "In response",
  submitted: "Submitted",
  won: "Won",
  handed_to_delivery: "Handed to delivery",
  lost: "Lost",
  withdrawn: "Withdrawn",
};
export interface Rfp {
  id: string;
  client: string;
  stage: RfpStage;
  deadline: string | null;
  responseOwner: string | null;
  accountOwner: string | null;
  presales: string | null;
  proposalSigned: boolean;
  brdApproved: boolean;
  deliveryProjectId: string | null;
  lossReason: string | null;
}
const day = 86_400_000;
export function rfpCard(rfp: Rfp, now: number) {
  const open = ![
    "submitted",
    "won",
    "handed_to_delivery",
    "lost",
    "withdrawn",
  ].includes(rfp.stage);
  const days =
    rfp.deadline === null
      ? null
      : Math.ceil((Date.parse(rfp.deadline) - now) / day);
  const countdown =
    days === null
      ? "No deadline set"
      : !open
        ? null
        : days < 0
          ? `${-days} ${days === -1 ? "day" : "days"} overdue`
          : days === 0
            ? "Due today"
            : `Due in ${days} ${days === 1 ? "day" : "days"}`;
  return {
    countdown,
    missingOwner: open && !rfp.responseOwner,
    atRisk: open && days !== null && days <= 7,
    subline:
      rfp.stage === "won"
        ? !rfp.proposalSigned
          ? "Awaiting signature"
          : !rfp.brdApproved
            ? "Awaiting approved BRD"
            : "Ready to hand to delivery"
        : rfp.stage === "lost"
          ? (rfp.lossReason ?? "Loss reason unknown")
          : null,
  };
}
export type Handoff =
  | { step: "not_won" }
  | { step: "wait"; pending: "signature" | "brd" }
  | { step: "reuse"; projectId: string }
  | { step: "create" };
/** A won RFP becomes a delivery project only after a signed proposal and approved BRD. */
export function rfpHandoff(rfp: Rfp): Handoff {
  if (rfp.stage !== "won" && rfp.stage !== "handed_to_delivery")
    return { step: "not_won" };
  if (!rfp.proposalSigned) return { step: "wait", pending: "signature" };
  if (!rfp.brdApproved) return { step: "wait", pending: "brd" };
  if (rfp.deliveryProjectId)
    return { step: "reuse", projectId: rfp.deliveryProjectId };
  return { step: "create" };
}
/** Amun tracks RFPs and never writes the response (Q40). */
export const rfpAuthoringBoundary =
  "Amun tracks RFPs: owners, deadline, status and outcome. Writing the response belongs to a separate product.";

// ── F9 external changes (UC16, Q75) ──────────────────────────────────────────
export interface ExternalChange {
  itemId: string;
  field: string;
  before: string | null;
  after: string | null;
  /** True when the change touches a sprint goal or a BRD date. */
  affectsCommitment: boolean;
}
export function externalChange(change: ExternalChange) {
  return {
    activity: `${change.field} changed in Azure DevOps: ${change.before ?? "empty"} → ${change.after ?? "empty"}`,
    flag: "Changed in ADO" as const,
    attention: change.affectsCommitment
      ? { primary: "Review impact", overflow: ["Acknowledge"] }
      : null,
    revert: false as const,
  };
}

// ── F10 memory update (UC17) ─────────────────────────────────────────────────
export interface Claim {
  key: string;
  value: string;
  source: string;
  date: string;
  /** Confirmed by the user, as opposed to inferred from evidence. */
  confirmed: boolean;
}
export type MemoryStep =
  | { step: "record"; supersedes: Claim | null }
  | { step: "ask"; text: string; current: Claim; incoming: Claim };
/** Conflicts with user-confirmed context are asked, citing source and date; history is kept. */
export function memoryUpdate(
  current: Claim | null,
  incoming: Claim,
): MemoryStep {
  if (!current || current.value === incoming.value)
    return { step: "record", supersedes: null };
  if (current.confirmed && !incoming.confirmed)
    return {
      step: "ask",
      text: `${incoming.source} (${incoming.date}) says "${incoming.value}". You told me "${current.value}". Which is right?`,
      current,
      incoming,
    };
  return { step: "record", supersedes: current };
}
export type SyncState = "saved" | "pending" | "unsaved";
/** Never claim persistence that was not confirmed. */
export function syncLabel(state: SyncState) {
  return state === "saved"
    ? null
    : state === "pending"
      ? "Saved on this Mac · waiting to sync to Notion"
      : "Not saved to Notion yet";
}

// ── Objectives (UC06, Q56) ───────────────────────────────────────────────────
export interface Objective {
  metric: string;
  baseline: number | null;
  target: number | null;
  current: number | null;
  evidenceDate: string | null;
  reviewDate: string | null;
  conflict: boolean;
}
export function objectiveProgress(objective: Objective) {
  if (objective.conflict)
    return { state: "conflict" as const, label: "Sources disagree · review" };
  if (
    objective.baseline === null ||
    objective.target === null ||
    objective.current === null
  )
    return {
      state: "unknown" as const,
      label:
        objective.target === null
          ? "Target not set"
          : objective.baseline === null
            ? "Baseline unknown"
            : "No measurement yet",
    };
  const span = objective.target - objective.baseline;
  const ratio =
    span === 0 ? 1 : (objective.current - objective.baseline) / span;
  const reached = ratio >= 1;
  return {
    state: reached ? ("reached" as const) : ("tracking" as const),
    ratio: Math.max(0, Math.min(1, ratio)),
    label: reached
      ? `Target reached${objective.reviewDate ? ` · next review ${objective.reviewDate}` : ""}`
      : `${objective.current} of ${objective.target} ${objective.metric}`,
  };
}
