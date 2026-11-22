// Production release & launch tracking and PRD discovery / decomposition
// validation (AMUN-WORK-INTAKE-AND-DELIVERY-CODING-HANDOFF §§2–4).
//
// Pure domain rules:
// - Problem-statement formats (Evidence-led 5W+H, Jobs to Be Done,
//   Outcome–Evidence–Scope) and the 20-topic PRD coverage checklist.
// - PRD-to-epic/story decomposition and first-release slice validation.
// - Production release lifecycle (readiness, scheduled, deploying,
//   verified_live, failed, rolled_back) with strict evidence gates:
//   - "verified_live" requires exact live version matching the target artifact
//     AND a passing smoke check on that exact version.
//   - Approval is bound to the exact artifact/commit; a newer commit marks
//     the approval stale.
//   - When no verified deployment adapter exists, read-only pipeline status
//     plus a release-owner receipt provides the evidence.

export const problemStatementFormats = [
  "evidence_5wh",
  "jtbd",
  "outcome_evidence_scope",
] as const;
export type ProblemStatementFormat = (typeof problemStatementFormats)[number];

export const problemStatementFormatLabels: Record<
  ProblemStatementFormat,
  string
> = {
  evidence_5wh: "Evidence-led 5W+H",
  jtbd: "Jobs to Be Done",
  outcome_evidence_scope: "Outcome–Evidence–Scope",
};

export const prdCoverageStates = [
  "evidenced",
  "captain-confirmed",
  "assumption",
  "open",
  "not_applicable",
] as const;
export type PrdCoverageState = (typeof prdCoverageStates)[number];

export const prdCoverageTopics = [
  [1, "Specific customer and boundaries with adjacent segments"],
  [2, "Customer job and desired outcome"],
  [3, "Current workflow and handoffs"],
  [4, "Painful step, frequency and consequence"],
  [5, "Alternatives, workarounds or doing nothing"],
  [6, "Sources that establish the pain and confidence in those sources"],
  [7, "Customer-visible improvement when it works"],
  [8, "Ideal end-to-end experience"],
  [9, "Smallest valuable scope"],
  [10, "Core capabilities needed"],
  [11, "Launch must-haves and non-goals"],
  [12, "Business objective and why it matters"],
  [13, "Primary success measure, baseline and target where known, guardrails"],
  [14, "Demand, reachable market and willingness to pay where relevant"],
  [
    15,
    "Alternatives on value, price, speed, quality and switching cost where relevant",
  ],
  [16, "Decision makers, approvers, contributors and affected stakeholders"],
  [
    17,
    "Functional and nonfunctional requirements, edge cases, permissions, data, integrations and errors",
  ],
  [
    18,
    "Technical, privacy, security, legal, operational and third-party constraints",
  ],
  [19, "Risks, contradictions, assumptions, open decisions and owners"],
  [
    20,
    "Delivery sequence, dependencies, deferred scope and launch prerequisites",
  ],
] as const;

export interface PrdCoverageEntry {
  topicNumber: number;
  state: PrdCoverageState;
  summary: string;
  /** Required when state === "not_applicable" or "evidenced". */
  sourceOrReason?: string | null;
}

export interface PrdDiscoveryCheck {
  whyProbes: readonly string[];
  format: ProblemStatementFormat | null;
  formatReason: string | null;
  problemStatement: string;
  coverage: readonly PrdCoverageEntry[];
}

export function evaluatePrdDiscovery(input: PrdDiscoveryCheck) {
  const distinctWhys = [
    ...new Set(
      input.whyProbes
        .map((probe) => probe.trim())
        .filter((probe) => probe.length >= 10),
    ),
  ];
  const hasThreeWhys = distinctWhys.length >= 3;
  const hasFormat =
    input.format !== null &&
    problemStatementFormats.includes(input.format) &&
    Boolean(input.formatReason?.trim()) &&
    Boolean(input.problemStatement.trim());

  const byTopic = new Map<number, PrdCoverageEntry>();
  for (const entry of input.coverage) byTopic.set(entry.topicNumber, entry);

  const openTopics: number[] = [];
  const assumptions: number[] = [];
  const confirmedOrEvidenced: number[] = [];
  const invalidNotApplicable: number[] = [];

  for (const [num] of prdCoverageTopics) {
    const entry = byTopic.get(num);
    if (!entry || entry.state === "open") {
      openTopics.push(num);
      continue;
    }
    if (entry.state === "assumption") {
      assumptions.push(num);
      continue;
    }
    if (entry.state === "not_applicable") {
      if (!entry.sourceOrReason?.trim()) invalidNotApplicable.push(num);
      continue;
    }
    confirmedOrEvidenced.push(num);
  }

  // Core discovery topics (1..4: customer, job, workflow, painful step) must
  // not remain open for a brief to exit discovery as ready.
  const coreGaps = [1, 2, 3, 4].filter((num) => {
    const state = byTopic.get(num)?.state;
    return !state || state === "open";
  });

  const ready =
    hasThreeWhys &&
    hasFormat &&
    coreGaps.length === 0 &&
    invalidNotApplicable.length === 0 &&
    confirmedOrEvidenced.length >= 12;

  return {
    ready,
    provisional: !ready,
    distinctWhyCount: distinctWhys.length,
    hasThreeWhys,
    hasFormat,
    coreGaps,
    openTopics,
    assumptions,
    confirmedOrEvidenced,
    invalidNotApplicable,
  };
}

// ── Section 3: PRD decomposition to Epics, Stories, and First Release Slice ──

export interface DecomposedEpic {
  id: string;
  title: string;
  outcome: string;
  sourceRequirementIds: string[];
}

export interface DecomposedStory {
  id: string;
  epicId: string;
  title: string;
  sourceRequirementIds: string[];
  acceptanceCriteria: string[];
  firstReleaseSlice: boolean;
  includesSecurityOrPermissions?: boolean;
  duplicateOfProviderId?: string | number | null;
  gapNote?: string | null;
}

export function validatePrdDecomposition(input: {
  requirements: readonly { id: string; text: string; nonGoal?: boolean }[];
  epics: readonly DecomposedEpic[];
  stories: readonly DecomposedStory[];
}) {
  const inScopeReqs = input.requirements.filter((r) => !r.nonGoal);
  const nonGoalIds = new Set(
    input.requirements.filter((r) => r.nonGoal).map((r) => r.id),
  );
  const epicIds = new Set(input.epics.map((e) => e.id));

  const coveredReqIds = new Set<string>();
  const leakedNonGoals: string[] = [];
  const storiesWithoutCriteria: string[] = [];
  const storiesWithUnknownEpic: string[] = [];

  for (const story of input.stories) {
    if (!epicIds.has(story.epicId)) storiesWithUnknownEpic.push(story.id);
    if (!story.acceptanceCriteria.some((c) => c.trim().length > 0))
      storiesWithoutCriteria.push(story.id);
    for (const reqId of story.sourceRequirementIds) {
      if (nonGoalIds.has(reqId)) leakedNonGoals.push(story.id);
      else coveredReqIds.add(reqId);
    }
  }

  const uncoveredRequirements = inScopeReqs
    .filter((r) => !coveredReqIds.has(r.id))
    .map((r) => r.id);
  const firstReleaseStories = input.stories.filter((s) => s.firstReleaseSlice);

  return {
    valid:
      uncoveredRequirements.length === 0 &&
      leakedNonGoals.length === 0 &&
      storiesWithoutCriteria.length === 0 &&
      storiesWithUnknownEpic.length === 0 &&
      firstReleaseStories.length > 0,
    uncoveredRequirements,
    leakedNonGoals,
    storiesWithoutCriteria,
    storiesWithUnknownEpic,
    firstReleaseCount: firstReleaseStories.length,
  };
}

// ── Section 4: Production Release & Launch Tracking ──────────────────────────

export const releaseStates = [
  "readiness",
  "scheduled",
  "deploying",
  "verified_live",
  "failed",
  "rolled_back",
] as const;
export type ReleaseState = (typeof releaseStates)[number];

export const releaseStateLabels: Record<ReleaseState, string> = {
  readiness: "Readiness",
  scheduled: "Scheduled",
  deploying: "Deploying",
  verified_live: "Verified live",
  failed: "Failed",
  rolled_back: "Rolled back",
};

export interface SmokeCheckEvidence {
  status: "pending" | "passed" | "failed";
  checkedVersion: string | null;
  summary: string;
  checkedAt: string | null;
}

export interface ReleaseApproval {
  approvedBy: string;
  approvedArtifact: string;
  approvedAt: string;
}

export interface ReleaseOwnerReceipt {
  owner: string;
  artifact: string;
  environment: string;
  liveVersion: string | null;
  smokePassed: boolean;
  recordedAt: string;
  notes?: string;
}

export interface ReleaseRecord {
  id: string;
  workAreaId: string;
  roadmapItemId: string | null;
  originatingChatId: string | null;
  requestRef: string | null;
  environment: string;
  releaseOwner: string | null;
  /** Exact target commit SHA or artifact digest/tag. */
  artifact: string;
  readinessEvidence: string[];
  approval: ReleaseApproval | null;
  deploymentId: string | null;
  requestedState: ReleaseState;
  /** Observed version running in production, when verified. */
  observedLiveVersion: string | null;
  smokeCheck: SmokeCheckEvidence | null;
  manualReceipt: ReleaseOwnerReceipt | null;
  rollbackTarget: string | null;
  rolledBackTo: string | null;
  rollbackReason: string | null;
  cancelledAt: string | null;
  postLaunchMetrics: { name: string; value: string; recordedAt: string }[];
  updatedAt: string;
}

export interface ReleaseEvaluation {
  /** Effective state shown in UI after applying strict evidence gates. */
  effectiveState: ReleaseState;
  /** Shown when a deployment finished or was requested live, but live version or smoke evidence is missing. */
  badge: string;
  staleArtifact: boolean;
  failedSmoke: boolean;
  partialEvidence: boolean;
  cancelled: boolean;
  canMarkVerifiedLive: boolean;
  reasons: string[];
}

/**
 * Evaluates a production release record.
 *
 * Rules from handoff §4:
 * - Approval belongs to the exact artifact/commit (`staleArtifact` if artifact changed).
 * - Requires evidence of the exact live version AND passing smoke result on that
 *   version (via pipeline or release-owner receipt) to show `verified_live`.
 * - Failed smoke check or partial evidence prevents `verified_live`.
 * - Cancellation and rollback preserve their distinct states and receipts.
 */
export function evaluateRelease(record: ReleaseRecord): ReleaseEvaluation {
  const reasons: string[] = [];
  const target = record.artifact.trim();

  const staleArtifact =
    record.approval !== null &&
    record.approval.approvedArtifact.trim() !== target;
  if (staleArtifact) {
    reasons.push(
      `Approval covers ${record.approval!.approvedArtifact}, not current artifact ${target}.`,
    );
  }

  if (record.cancelledAt) {
    reasons.push(`Cancelled at ${record.cancelledAt}.`);
    return {
      effectiveState: "readiness",
      badge: "Cancelled",
      staleArtifact,
      failedSmoke: false,
      partialEvidence: false,
      cancelled: true,
      canMarkVerifiedLive: false,
      reasons,
    };
  }

  if (record.requestedState === "rolled_back" || record.rolledBackTo) {
    const to =
      record.rolledBackTo ?? record.rollbackTarget ?? "previous version";
    reasons.push(
      `Rolled back to ${to}${record.rollbackReason ? `: ${record.rollbackReason}` : ""}.`,
    );
    return {
      effectiveState: "rolled_back",
      badge: "Rolled back",
      staleArtifact,
      failedSmoke: record.smokeCheck?.status === "failed",
      partialEvidence: false,
      cancelled: false,
      canMarkVerifiedLive: false,
      reasons,
    };
  }

  const failedSmoke =
    record.smokeCheck?.status === "failed" ||
    (record.manualReceipt !== null && !record.manualReceipt.smokePassed);
  if (failedSmoke) {
    reasons.push(
      record.smokeCheck?.summary ||
        "Smoke check failed on the deployed version.",
    );
  }

  if (record.requestedState === "failed" || failedSmoke) {
    return {
      effectiveState: "failed",
      badge: failedSmoke ? "Failed smoke check" : "Failed",
      staleArtifact,
      failedSmoke,
      partialEvidence: false,
      cancelled: false,
      canMarkVerifiedLive: false,
      reasons,
    };
  }

  const liveVersionMatches =
    (record.observedLiveVersion !== null &&
      record.observedLiveVersion.trim() === target) ||
    (record.manualReceipt !== null &&
      record.manualReceipt.artifact.trim() === target &&
      record.manualReceipt.liveVersion?.trim() === target);

  const smokeMatches =
    (record.smokeCheck !== null &&
      record.smokeCheck.status === "passed" &&
      record.smokeCheck.checkedVersion?.trim() === target) ||
    (record.manualReceipt !== null &&
      record.manualReceipt.artifact.trim() === target &&
      record.manualReceipt.liveVersion?.trim() === target &&
      record.manualReceipt.smokePassed);

  const approvedForTarget =
    record.approval !== null && !staleArtifact && Boolean(target);

  const canMarkVerifiedLive =
    Boolean(target) &&
    approvedForTarget &&
    liveVersionMatches &&
    smokeMatches &&
    !failedSmoke;

  if (record.requestedState === "verified_live") {
    if (canMarkVerifiedLive) {
      return {
        effectiveState: "verified_live",
        badge: "Verified live",
        staleArtifact: false,
        failedSmoke: false,
        partialEvidence: false,
        cancelled: false,
        canMarkVerifiedLive: true,
        reasons,
      };
    }
    if (!approvedForTarget && !staleArtifact)
      reasons.push("Release approval for this exact artifact is missing.");
    if (!liveVersionMatches)
      reasons.push("Exact live version has not been verified in production.");
    if (!smokeMatches)
      reasons.push("Passing smoke check for this exact version is missing.");
    return {
      effectiveState: "deploying",
      badge: "Pending verification",
      staleArtifact,
      failedSmoke: false,
      partialEvidence: true,
      cancelled: false,
      canMarkVerifiedLive: false,
      reasons,
    };
  }

  const partialEvidence =
    record.requestedState === "deploying" &&
    (liveVersionMatches !== smokeMatches || staleArtifact);

  return {
    effectiveState: staleArtifact ? "readiness" : record.requestedState,
    badge: staleArtifact
      ? "Stale artifact · re-approve"
      : partialEvidence
        ? "Pending verification"
        : releaseStateLabels[record.requestedState],
    staleArtifact,
    failedSmoke: false,
    partialEvidence,
    cancelled: false,
    canMarkVerifiedLive,
    reasons,
  };
}
