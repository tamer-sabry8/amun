import { describe, expect, it } from "vitest";
import {
  evaluatePrdDiscovery,
  evaluateRelease,
  prdCoverageTopics,
  problemStatementFormatLabels,
  validatePrdDecomposition,
  type PrdCoverageEntry,
  type ReleaseRecord,
} from "../src/work/release-launch.ts";

describe("PRD discovery and problem-statement rules (Handoff §2)", () => {
  const fullCoverage = (): PrdCoverageEntry[] =>
    prdCoverageTopics.map(([topicNumber, label]) => ({
      topicNumber,
      state: topicNumber <= 15 ? "captain-confirmed" : "evidenced",
      summary: `Confirmed ${label}`,
      sourceOrReason: "Captain interview & Q3 logs",
    }));

  it("supports the three problem-statement formats and requires 3+ distinct why probes", () => {
    expect(problemStatementFormatLabels).toEqual({
      evidence_5wh: "Evidence-led 5W+H",
      jtbd: "Jobs to Be Done",
      outcome_evidence_scope: "Outcome–Evidence–Scope",
    });

    const ready = evaluatePrdDiscovery({
      whyProbes: [
        "Why does the enterprise team abandon onboarding at step 3?",
        "Why is manual role mapping failing for >50 seats?",
        "Why haven't existing CSV templates solved this for IT admins?",
      ],
      format: "evidence_5wh",
      formatReason:
        "B2B operational workflow with measurable drop-off evidence",
      problemStatement:
        "Enterprise IT admins managing >50 seats abandon SSO setup during manual role mapping because CSV imports lack schema validation.",
      coverage: fullCoverage(),
    });
    expect(ready.ready).toBe(true);
    expect(ready.provisional).toBe(false);
    expect(ready.distinctWhyCount).toBe(3);
  });

  it("keeps discovery provisional when fewer than 3 why probes or core gaps remain open", () => {
    const coverage = fullCoverage();
    coverage[2] = {
      topicNumber: 3,
      state: "open",
      summary: "Need current workflow",
    };

    const result = evaluatePrdDiscovery({
      whyProbes: ["Why now?", "Why now?"],
      format: "jtbd",
      formatReason: "Job-centered workflow",
      problemStatement:
        "When I onboard a new department, I want automated role sync so I can grant access in one day.",
      coverage,
    });
    expect(result.ready).toBe(false);
    expect(result.provisional).toBe(true);
    expect(result.hasThreeWhys).toBe(false);
    expect(result.coreGaps).toEqual([3]);
  });

  it("requires an explicit reason when a topic among the 20 is marked not_applicable", () => {
    const coverage = fullCoverage();
    coverage[13] = {
      topicNumber: 14,
      state: "not_applicable",
      summary: "Internal platform tool",
      sourceOrReason: "",
    };

    const invalid = evaluatePrdDiscovery({
      whyProbes: [
        "Why are internal deploys taking 45 minutes?",
        "Why do engineers bypass the staging check?",
        "Why did the previous script fail on monorepos?",
      ],
      format: "outcome_evidence_scope",
      formatReason: "Internal platform reliability metric",
      problemStatement: "Cut internal deploy lead time from 45m to 10m.",
      coverage,
    });
    expect(invalid.ready).toBe(false);
    expect(invalid.invalidNotApplicable).toEqual([14]);
  });
});

describe("PRD decomposition into epics, stories, and first release slice (Handoff §3)", () => {
  it("verifies traceability from in-scope requirements to stories, excludes non-goals, and requires a first-release slice", () => {
    const requirements = [
      { id: "R1", text: "Validate role mapping schema on upload" },
      { id: "R2", text: "Enforce RBAC permissions for org admins" },
      { id: "NG1", text: "Custom SCIM v1 legacy adapter", nonGoal: true },
    ];
    const epics = [
      {
        id: "E1",
        title: "Automated Role Mapping",
        outcome: "Admins complete mapping with zero schema errors",
        sourceRequirementIds: ["R1", "R2"],
      },
    ];
    const stories = [
      {
        id: "S1",
        epicId: "E1",
        title: "CSV schema validator with inline error rows",
        sourceRequirementIds: ["R1"],
        acceptanceCriteria: ["Rejects malformed role columns with row numbers"],
        firstReleaseSlice: true,
      },
      {
        id: "S2",
        epicId: "E1",
        title: "Org-admin permission guard on role import endpoint",
        sourceRequirementIds: ["R2"],
        acceptanceCriteria: ["Non-admin receives 403 and audit log entry"],
        firstReleaseSlice: false,
        includesSecurityOrPermissions: true,
      },
    ];

    const valid = validatePrdDecomposition({ requirements, epics, stories });
    expect(valid.valid).toBe(true);
    expect(valid.uncoveredRequirements).toEqual([]);
    expect(valid.leakedNonGoals).toEqual([]);
    expect(valid.firstReleaseCount).toBe(1);

    const leaked = validatePrdDecomposition({
      requirements,
      epics,
      stories: [
        ...stories,
        {
          id: "S3",
          epicId: "E1",
          title: "Build SCIM v1 adapter",
          sourceRequirementIds: ["NG1"],
          acceptanceCriteria: ["Syncs v1 users"],
          firstReleaseSlice: false,
        },
      ],
    });
    expect(leaked.valid).toBe(false);
    expect(leaked.leakedNonGoals).toEqual(["S3"]);
  });
});

describe("Production release & launch tracking state machine (Handoff §4)", () => {
  const baseRecord = (extra: Partial<ReleaseRecord> = {}): ReleaseRecord => ({
    id: "rel-1",
    workAreaId: "area-sdk",
    roadmapItemId: "rm-1",
    originatingChatId: "chat-1",
    requestRef: "amun-r-rel1",
    environment: "production",
    releaseOwner: "Tamer",
    artifact: "sha-7f8a9b0",
    readinessEvidence: ["CI green", "Migration dry-run passed"],
    approval: {
      approvedBy: "Tamer",
      approvedArtifact: "sha-7f8a9b0",
      approvedAt: "2026-11-22T10:00:00Z",
    },
    deploymentId: "deploy-42",
    requestedState: "deploying",
    observedLiveVersion: null,
    smokeCheck: null,
    manualReceipt: null,
    rollbackTarget: "sha-6e5d4c3",
    rolledBackTo: null,
    rollbackReason: null,
    cancelledAt: null,
    postLaunchMetrics: [],
    updatedAt: "2026-11-22T10:05:00Z",
    ...extra,
  });

  it("marks verified_live only when exact target artifact is approved, live in production, and passes smoke check", () => {
    const verified = evaluateRelease(
      baseRecord({
        requestedState: "verified_live",
        observedLiveVersion: "sha-7f8a9b0",
        smokeCheck: {
          status: "passed",
          checkedVersion: "sha-7f8a9b0",
          summary: "Health, auth, and role import endpoints 200 OK",
          checkedAt: "2026-11-22T10:06:00Z",
        },
      }),
    );
    expect(verified.effectiveState).toBe("verified_live");
    expect(verified.badge).toBe("Verified live");
    expect(verified.canMarkVerifiedLive).toBe(true);
    expect(verified.partialEvidence).toBe(false);
  });

  it("supports read-only pipeline + release-owner receipt when no deployment adapter exists", () => {
    const verifiedByReceipt = evaluateRelease(
      baseRecord({
        requestedState: "verified_live",
        observedLiveVersion: null,
        smokeCheck: null,
        manualReceipt: {
          owner: "Tamer",
          artifact: "sha-7f8a9b0",
          environment: "production",
          liveVersion: "sha-7f8a9b0",
          smokePassed: true,
          recordedAt: "2026-11-22T10:10:00Z",
          notes: "Verified production release tag and smoke suite",
        },
      }),
    );
    expect(verifiedByReceipt.effectiveState).toBe("verified_live");
    expect(verifiedByReceipt.canMarkVerifiedLive).toBe(true);
  });

  it("blocks verified_live and flags partial evidence when live version or smoke check is missing", () => {
    const partial = evaluateRelease(
      baseRecord({
        requestedState: "verified_live",
        observedLiveVersion: "sha-7f8a9b0",
        smokeCheck: null,
      }),
    );
    expect(partial.effectiveState).toBe("deploying");
    expect(partial.badge).toBe("Pending verification");
    expect(partial.partialEvidence).toBe(true);
    expect(partial.canMarkVerifiedLive).toBe(false);
  });

  it("detects stale artifact when a newer commit replaces the approved artifact", () => {
    const stale = evaluateRelease(
      baseRecord({
        artifact: "sha-9999999",
        requestedState: "scheduled",
      }),
    );
    expect(stale.staleArtifact).toBe(true);
    expect(stale.effectiveState).toBe("readiness");
    expect(stale.badge).toBe("Stale artifact · re-approve");
    expect(stale.canMarkVerifiedLive).toBe(false);
  });

  it("transitions to failed on a failed smoke check and never reports verified_live", () => {
    const failed = evaluateRelease(
      baseRecord({
        requestedState: "verified_live",
        observedLiveVersion: "sha-7f8a9b0",
        smokeCheck: {
          status: "failed",
          checkedVersion: "sha-7f8a9b0",
          summary: "POST /roles/import returned 502",
          checkedAt: "2026-11-22T10:07:00Z",
        },
      }),
    );
    expect(failed.effectiveState).toBe("failed");
    expect(failed.failedSmoke).toBe(true);
    expect(failed.badge).toBe("Failed smoke check");
    expect(failed.canMarkVerifiedLive).toBe(false);
  });

  it("handles cancellation before deploy and rollback to previous good version", () => {
    const cancelled = evaluateRelease(
      baseRecord({
        requestedState: "scheduled",
        cancelledAt: "2026-11-22T10:02:00Z",
      }),
    );
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.effectiveState).toBe("readiness");
    expect(cancelled.badge).toBe("Cancelled");

    const rolledBack = evaluateRelease(
      baseRecord({
        requestedState: "rolled_back",
        rolledBackTo: "sha-6e5d4c3",
        rollbackReason: "Smoke check 502 on /roles/import",
      }),
    );
    expect(rolledBack.effectiveState).toBe("rolled_back");
    expect(rolledBack.badge).toBe("Rolled back");
    expect(rolledBack.reasons[0]).toContain("sha-6e5d4c3");
  });
});
