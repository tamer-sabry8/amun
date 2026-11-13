// Permissions and approvals (handoff §8, Q47–Q51, Q76). No autonomy levels:
// three hard gates always ask; everything else follows an explicit instruction,
// a narrow standing permission, or asks for the concrete change.

export type Destination =
  "ado" | "notion" | "github" | "jira" | "amun" | string;
export type OperationAction =
  | "create"
  | "update"
  | "backlog_add"
  | "roadmap_commit"
  | "use_context"
  | "prepare"
  | "draft";

export interface Operation {
  action: OperationAction;
  destination: Destination;
  groupId: string | null;
  /** Group the information comes from, when different from the target group. */
  sourceGroupId?: string | null;
}
export interface StandingPermission {
  id: string;
  groupId: string;
  destination: Destination;
  action: OperationAction;
  revokedAt: string | null;
}

export type Gate = "ado_write" | "backlog_or_roadmap" | "cross_group";
export const gateLabels: Record<Gate, string> = {
  ado_write: "Writing to Azure DevOps",
  backlog_or_roadmap:
    "Adding findings to the delivery backlog or changing the committed roadmap",
  cross_group: "Using information across groups",
};

/** The three gates no setting can bypass. */
export function gateFor(operation: Operation): Gate | null {
  if (
    operation.sourceGroupId !== undefined &&
    operation.sourceGroupId !== operation.groupId
  )
    return "cross_group";
  if (operation.action === "use_context") return null;
  if (
    operation.action === "backlog_add" ||
    operation.action === "roadmap_commit"
  )
    return "backlog_or_roadmap";
  if (
    operation.destination === "ado" &&
    operation.action !== "prepare" &&
    operation.action !== "draft"
  )
    return "ado_write";
  return null;
}

export type Authority =
  | { allowed: true; basis: "preparing" | "standing" | "instruction" }
  | { allowed: false; ask: "gate"; gate: Gate }
  | { allowed: false; ask: "approval" };

/**
 * Preparing never needs approval; committing does. A standing permission or an
 * explicit instruction can authorise an ungated write, never a gated one.
 */
export function authority(
  operation: Operation,
  context: { permissions: StandingPermission[]; instructed?: boolean } = {
    permissions: [],
  },
): Authority {
  const gate = gateFor(operation);
  if (gate) return { allowed: false, ask: "gate", gate };
  if (operation.action === "prepare" || operation.action === "use_context")
    return { allowed: true, basis: "preparing" };
  if (context.instructed) return { allowed: true, basis: "instruction" };
  const standing = context.permissions.some(
    (permission) =>
      !permission.revokedAt &&
      permission.groupId === operation.groupId &&
      permission.destination === operation.destination &&
      permission.action === operation.action,
  );
  return standing
    ? { allowed: true, basis: "standing" }
    : { allowed: false, ask: "approval" };
}

export interface PlanItem {
  id: string;
  summary: string;
  /** Anything that changes what would be written: title, sprint, assignee… */
  fields: Record<string, string | number | null>;
}
export interface Plan {
  destination: Destination;
  items: PlanItem[];
}
const canonical = (item: PlanItem) =>
  JSON.stringify([
    item.id,
    Object.entries(item.fields).sort(([a], [b]) => a.localeCompare(b)),
  ]);

/** Stable fingerprint of exactly what was shown for approval. */
export function planFingerprint(plan: Plan) {
  return [plan.destination, ...plan.items.map(canonical).sort()].join("\n");
}

export type PlanChange =
  { changed: false } | { changed: true; reason: string; outside: string[] };
/**
 * Approve plans, not clicks: an approval covers exactly the batch shown. Any
 * item added or altered after approval is outside it and must be asked again;
 * removing items stays inside the approved scope.
 */
export function changeSinceApproval(approved: Plan, current: Plan): PlanChange {
  if (approved.destination !== current.destination)
    return {
      changed: true,
      reason: "The destination changed after you opened this review.",
      outside: current.items.map((item) => item.id),
    };
  const known = new Set(approved.items.map(canonical));
  const outside = current.items
    .filter((item) => !known.has(canonical(item)))
    .map((item) => item.id);
  return outside.length
    ? {
        changed: true,
        reason: `${outside.length} ${outside.length === 1 ? "item has" : "items have"} changed since you opened this review.`,
        outside,
      }
    : { changed: false };
}

/** Small batches resolve in the Home tray; sprint plans and roadmaps open the right pane (Q51). */
export function approvalSurface(plan: {
  kind: "stories" | "sprint_plan" | "roadmap" | "edit";
  count: number;
}): "tray" | "pane" {
  return plan.kind === "sprint_plan" ||
    plan.kind === "roadmap" ||
    plan.count > 12
    ? "pane"
    : "tray";
}

export function approveLabel(count: number, noun = "story") {
  const plural = noun.endsWith("y") ? noun.slice(0, -1) + "ies" : noun + "s";
  return `Approve and publish ${count} ${count === 1 ? noun : plural}`;
}

export interface WriteResult {
  id: string;
  state: "created" | "failed" | "unknown";
  externalId?: string | undefined;
  url?: string | undefined;
}
/** Partial writes are reported per item; an uncertain write is never replayed blind (UC21). */
export function writeSummary(results: WriteResult[]) {
  const created = results.filter((result) => result.state === "created");
  const failed = results.filter((result) => result.state === "failed");
  const unknown = results.filter((result) => result.state === "unknown");
  const retry = failed.map((result) => result.id);
  return {
    created: created.length,
    failed: failed.length,
    unknown: unknown.length,
    retry,
    reconcileFirst: unknown.map((result) => result.id),
    text:
      `${created.length} created, ${failed.length} not created` +
      (unknown.length ? `, ${unknown.length} being checked` : "") +
      ", nothing duplicated",
    button: unknown.length
      ? "Check what was created"
      : retry.length
        ? `Retry the ${retry.length}`
        : null,
  };
}

export interface RuleCase {
  /** Stable key for the situation, e.g. "sheet-vs-project:allocation". */
  situation: string;
  groupId: string;
  resolution: string;
  /** Distinct source event so repeated copies of one event are not counted twice. */
  eventId: string;
}
export interface LearnedRule {
  id: string;
  groupId: string;
  situation: string;
  resolution: string;
  state: "active" | "declined" | "never" | "revoked";
}
export const ruleThreshold = 5;

/**
 * Q76 / UC22: after the Nth independent matching resolution, propose one
 * bounded rule. "Not now" may be asked again later; "Never ask" may not.
 */
export function ruleCandidate(
  cases: RuleCase[],
  rules: LearnedRule[],
  threshold = ruleThreshold,
) {
  const groups = new Map<string, RuleCase[]>();
  for (const item of cases) {
    const key = [item.groupId, item.situation, item.resolution].join("\u0000");
    const list = groups.get(key) ?? [];
    if (!list.some((existing) => existing.eventId === item.eventId))
      list.push(item);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    const first = list[0]!;
    if (list.length < threshold) continue;
    const settled = rules.some(
      (rule) =>
        rule.groupId === first.groupId &&
        rule.situation === first.situation &&
        (rule.state === "active" || rule.state === "never"),
    );
    if (settled) continue;
    return {
      groupId: first.groupId,
      situation: first.situation,
      resolution: first.resolution,
      examples: list.length,
      ask: `This has happened ${list.length} times. Should I ${first.resolution} next time?`,
      choices: ["Yes, remember", "Not now", "Never ask"] as const,
    };
  }
  return null;
}

/** A learned rule applies only inside its own group and situation. */
export function appliedRule(
  rules: LearnedRule[],
  groupId: string,
  situation: string,
) {
  return (
    rules.find(
      (rule) =>
        rule.state === "active" &&
        rule.groupId === groupId &&
        rule.situation === situation,
    ) ?? null
  );
}
