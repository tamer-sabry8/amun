// Small-project checklist & handover receipt (Item 6) and
// Production release & launch tracking card (Item 16).
import { useState } from "react";
import {
  appendProjectChecklistTask,
  evaluateRelease,
  parseProjectChecklist,
  releaseStateLabels,
  releaseStates,
  toggleProjectChecklistLine,
  type ReleaseRecord,
  type ReleaseState,
} from "../../../../packages/domain/src/work/release-launch.ts";
import { work, workAsync } from "./store.ts";
import {
  releaseReadiness,
  storyGroup,
} from "../../../../packages/domain/src/work/delivery-chain.ts";
import type { Snapshot } from "./view-model.ts";

export const projectChecklistDocType = "project_checklist";
export const releaseTrackerDocType = "release_tracker";

export function ProjectChecklistPane({
  snapshot,
  areaId,
  onAsk,
}: {
  snapshot: Snapshot;
  areaId: string;
  onAsk(text: string): void;
}) {
  const area = snapshot.areas.find((item) => item.id === areaId);
  const doc = snapshot.library.find(
    (item) =>
      item.section === "output" &&
      item.type === projectChecklistDocType &&
      item.workAreaIds.includes(areaId) &&
      item.status !== "Archived",
  );
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [handoverNote, setHandoverNote] = useState("");
  const [notice, setNotice] = useState("");

  const body = doc?.body ?? "";
  const tasks = parseProjectChecklist(body);
  const doneCount = tasks.filter((t) => t.done).length;
  const percent = tasks.length
    ? Math.round((doneCount / tasks.length) * 100)
    : 0;

  const saveBody = async (nextBody: string, nextStatus?: string) => {
    await workAsync("save-output", {
      ...(doc ? { outputId: doc.id } : {}),
      groupId: area?.groupId ?? null,
      type: projectChecklistDocType,
      title: doc?.title ?? `${area?.name ?? "Project"} checklist`,
      body: nextBody,
      status: nextStatus ?? doc?.status ?? "Active",
      workAreaIds: [areaId],
    });
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div
        className="row wrap"
        style={{ justifyContent: "space-between", alignItems: "center" }}
      >
        <div>
          <strong style={{ fontSize: 17 }}>
            {area?.name ?? "Project"} checklist
          </strong>
          <div className="muted small">
            Scoped tasks, owner, due date, and client handover receipt
          </div>
        </div>
        <span className={"tag " + (percent === 100 ? "good" : "accent")}>
          {tasks.length
            ? `${doneCount} of ${tasks.length} done · ${percent}%`
            : "Local checklist"}
        </span>
      </div>

      {tasks.length > 0 ? (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gap: 8,
          }}
          aria-label="Project checklist tasks"
        >
          {tasks.map((task) => (
            <li
              key={task.lineIndex}
              className="rb-inline"
              style={{
                display: "grid",
                gridTemplateColumns: "24px 1fr auto",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
              }}
            >
              <input
                type="checkbox"
                aria-label={task.title}
                checked={task.done}
                onChange={() => {
                  const next = toggleProjectChecklistLine(body, task.lineIndex);
                  void saveBody(next);
                }}
                style={{ width: 17, height: 17, cursor: "pointer" }}
              />
              <span
                style={{
                  fontWeight: 500,
                  textDecoration: task.done ? "line-through" : "none",
                  opacity: task.done ? 0.65 : 1,
                }}
              >
                {task.title}
              </span>
              <span className="muted small">
                {[task.owner, task.due].filter(Boolean).join(" · ") || "—"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          No tasks in this checklist yet. Add the scoped tasks below or ask
          Firstmate to populate them from your brief.
        </p>
      )}

      <form
        className="rb-inline"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) return;
          const next = appendProjectChecklistTask(body, {
            title: title.trim(),
            owner: owner.trim() || null,
            due: due.trim() || null,
          });
          setTitle("");
          setOwner("");
          setDue("");
          void saveBody(next);
        }}
      >
        <strong className="small">Add a checklist task</strong>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.6fr 1fr 1fr auto",
            gap: 8,
            alignItems: "center",
          }}
        >
          <input
            type="text"
            aria-label="Task title"
            placeholder="Task (e.g. Lock 5-minute booth demo script)"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
          <input
            type="text"
            aria-label="Task owner"
            placeholder="Owner (e.g. Tamer)"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          />
          <input
            type="text"
            aria-label="Task due date"
            placeholder="Due (e.g. 4 Dec)"
            value={due}
            onChange={(event) => setDue(event.target.value)}
          />
          <button className="btn" type="submit">
            Add task
          </button>
        </div>
      </form>

      <div
        className="rb-inline amber"
        role="group"
        aria-label="Acceptance and handover receipt"
      >
        <strong>Acceptance &amp; handover receipt</strong>
        <span className="small">
          {area?.status === "completed" || doc?.status === "Handed over"
            ? `Handover recorded for ${area?.client ? `client ${area.client}` : (area?.name ?? "this project")}.`
            : tasks.length > 0 && doneCount < tasks.length
              ? `${tasks.length - doneCount} task${tasks.length - doneCount === 1 ? " is" : "s are"} still open before handover. Recording handover marks the project delivered and links the receipt to Portfolio.`
              : "All checklist tasks are complete. Record client acceptance and handover to mark the project delivered in Portfolio."}
        </span>
        <input
          type="text"
          aria-label="Handover acceptance note"
          placeholder={
            area?.client
              ? `Who accepted for ${area.client} and any handover note`
              : "Who accepted and any handover note"
          }
          value={handoverNote}
          onChange={(event) => setHandoverNote(event.target.value)}
        />
        <div className="row wrap">
          <button
            className="btn primary"
            type="button"
            onClick={async () => {
              const stamp = new Date().toISOString().slice(0, 10);
              const who =
                handoverNote.trim() ||
                (area?.client
                  ? `Accepted by ${area.client}`
                  : "Accepted by owner");
              const receiptLine = `\n\n---\n**Handover receipt (${stamp}):** ${who} (${doneCount}/${tasks.length} checklist tasks completed).`;
              await saveBody(
                (body.trimEnd() || "# Project checklist") + receiptLine,
                "Handed over",
              );
              work("update-area", {
                areaId,
                patch: { status: "completed" },
              });
              setHandoverNote("");
              setNotice(
                "Handover receipt recorded and project marked completed.",
              );
            }}
          >
            Record handover &amp; close project
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              const openTasks = tasks
                .filter((t) => !t.done)
                .map(
                  (t) =>
                    `${t.title}${t.owner ? ` (owner: ${t.owner})` : ""}${t.due ? ` (due: ${t.due})` : ""}`,
                );
              onAsk(
                openTasks.length
                  ? `Please promote these checklist tasks for ${area?.name ?? "this project"} into governed Azure DevOps stories for my review: ${openTasks.join("; ")}`
                  : `Please propose governed Azure DevOps stories from the ${area?.name ?? "project"} checklist for my review.`,
              );
            }}
          >
            Promote to Azure DevOps stories
          </button>
        </div>
        {notice && (
          <span className="small" role="status">
            {notice}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Production Release & Launch Tracking Card (Item 16) ─────────────────────

function defaultReleaseRecord(
  workAreaId: string,
  releaseName: string,
): ReleaseRecord {
  return {
    id: `rel-${workAreaId}-${releaseName}`,
    workAreaId,
    roadmapItemId: null,
    originatingChatId: null,
    requestRef: null,
    environment: "production (or client air-gapped site)",
    releaseOwner: null,
    artifact: "",
    readinessEvidence: [],
    approval: null,
    deploymentId: null,
    requestedState: "readiness",
    observedLiveVersion: null,
    smokeCheck: null,
    manualReceipt: null,
    rollbackTarget: null,
    rolledBackTo: null,
    rollbackReason: null,
    cancelledAt: null,
    postLaunchMetrics: [],
    updatedAt: new Date().toISOString(),
  };
}

function parseReleaseRecord(
  raw: string | undefined,
  workAreaId: string,
  releaseName: string,
): ReleaseRecord {
  if (!raw) return defaultReleaseRecord(workAreaId, releaseName);
  try {
    const parsed = JSON.parse(raw) as Partial<ReleaseRecord>;
    return {
      ...defaultReleaseRecord(workAreaId, releaseName),
      ...parsed,
      workAreaId,
    };
  } catch {
    return defaultReleaseRecord(workAreaId, releaseName);
  }
}

export function ProductionReleaseCard({
  snapshot,
  workAreaId,
  releaseName,
  roadmapTitle,
  doneStories,
  totalStories,
}: {
  snapshot: Snapshot;
  workAreaId: string;
  releaseName: string;
  roadmapTitle?: string;
  doneStories: number;
  totalStories: number;
}) {
  const area = snapshot.areas.find((item) => item.id === workAreaId);
  const docTitle = `Release: ${releaseName}`;
  const doc = snapshot.library.find(
    (item) =>
      item.section === "output" &&
      item.type === releaseTrackerDocType &&
      item.workAreaIds.includes(workAreaId) &&
      item.title === docTitle,
  );
  const latestReq =
    snapshot.requests.filter((r) => r.projectAreaId === workAreaId).at(-1)
      ?.ref ?? null;

  const record = parseReleaseRecord(doc?.body, workAreaId, releaseName);
  const evaluation = evaluateRelease(record);
  // Readiness gate (Idea to Done §4.10, approved 23 November 2026): the
  // release lists the stories it ships, and Schedule waits until they are
  // Done, unless they move to the next release or the owner releases anyway
  // with a written reason.
  const shippedIds = doc
    ? snapshot.deliveryLinks
        .filter(
          (link) => link.kind === "release_story" && link.fromId === doc.id,
        )
        .map((link) => link.toId)
    : [];
  const workStories = (
    snapshot.delivery.find((item) => item.workAreaId === workAreaId)?.items ??
    []
  ).filter(
    (item) =>
      item.type.toLowerCase() !== "epic" &&
      storyGroup(item.status) !== "removed",
  );
  const shipped = workStories.filter((item) => shippedIds.includes(item.id));
  const readiness = releaseReadiness(shipped);
  const anywayReason = record.readinessEvidence
    .find((line) => line.startsWith("Released anyway: "))
    ?.slice("Released anyway: ".length);
  const gateOpen = readiness.ready || Boolean(anywayReason);
  const live = evaluation.effectiveState === "verified_live";
  const [anyway, setAnyway] = useState<string | null>(null);
  const [closeOut, setCloseOut] = useState<string | null>(null);

  const [artifactInput, setArtifactInput] = useState(record.artifact);
  const [ownerInput, setOwnerInput] = useState(record.releaseOwner ?? "");
  const [envInput, setEnvInput] = useState(record.environment);
  const [rollbackTargetInput, setRollbackTargetInput] = useState(
    record.rollbackTarget ?? "",
  );
  const [metricInput, setMetricInput] = useState(
    record.postLaunchMetrics[0]?.value ?? "",
  );
  const [showReceiptForm, setShowReceiptForm] = useState(false);

  const saveRecord = async (patch: Partial<ReleaseRecord>) => {
    const next: ReleaseRecord = {
      ...record,
      ...patch,
      requestRef: record.requestRef ?? latestReq,
      updatedAt: new Date().toISOString(),
    };
    await workAsync("save-output", {
      ...(doc ? { outputId: doc.id } : {}),
      groupId: area?.groupId ?? null,
      type: releaseTrackerDocType,
      title: docTitle,
      body: JSON.stringify(next, null, 2),
      status: releaseStateLabels[evaluateRelease(next).effectiveState],
      workAreaIds: [workAreaId],
    });
  };

  const badgeTone =
    evaluation.effectiveState === "verified_live"
      ? "good"
      : evaluation.effectiveState === "failed" ||
          evaluation.effectiveState === "rolled_back"
        ? "bad"
        : evaluation.staleArtifact || evaluation.partialEvidence
          ? "warn"
          : "accent";

  return (
    <section
      className="rb-panel"
      aria-label={`Production release ${releaseName}`}
      style={{ marginTop: 14, display: "grid", gap: 12 }}
    >
      <header
        className="row wrap"
        style={{ justifyContent: "space-between", alignItems: "center" }}
      >
        <div>
          <strong style={{ fontSize: 16 }}>
            {area?.name ?? "Work area"} · {releaseName} Production Launch
          </strong>
          <div className="muted small">
            {[
              `Work area: ${area?.name ?? "—"}`,
              roadmapTitle ? `Roadmap: ${roadmapTitle}` : null,
              record.requestRef || latestReq
                ? `Chat ref: ${record.requestRef ?? latestReq}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <span className={`tag ${badgeTone}`}>{evaluation.badge}</span>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
          gap: 8,
        }}
        role="group"
        aria-label="Release stages"
      >
        {releaseStates.map((stage: ReleaseState) => {
          const active = evaluation.effectiveState === stage;
          return (
            <div
              key={stage}
              className="rb-inline"
              style={{
                padding: "8px 10px",
                borderColor: active ? "var(--accent)" : undefined,
              }}
            >
              <strong className="small" style={{ display: "block" }}>
                {releaseStateLabels[stage]}
              </strong>
              <span className="muted small" style={{ fontSize: 11.5 }}>
                {stage === "readiness"
                  ? `${doneStories}/${totalStories} stories done`
                  : stage === "scheduled"
                    ? record.approval
                      ? `Approved (${record.approval.approvedArtifact})`
                      : "Awaiting approval"
                    : stage === "deploying"
                      ? (record.deploymentId ?? "Repo / Client site")
                      : stage === "verified_live"
                        ? evaluation.canMarkVerifiedLive
                          ? "Exact tag & smoke OK"
                          : "Needs receipt / smoke"
                        : stage === "failed"
                          ? evaluation.failedSmoke
                            ? "Smoke check failed"
                            : "No failure"
                          : record.rolledBackTo
                            ? `Restored ${record.rolledBackTo}`
                            : record.rollbackTarget
                              ? `Target ${record.rollbackTarget}`
                              : "Rollback ready"}
              </span>
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        <label className="field small">
          <span className="muted">Environment / Client site &amp; Owner</span>
          <div className="row" style={{ gap: 6 }}>
            <input
              type="text"
              aria-label="Release environment"
              placeholder="e.g. MoI air-gapped on-prem"
              value={envInput}
              onChange={(event) => setEnvInput(event.target.value)}
              onBlur={() => {
                if (envInput !== record.environment)
                  void saveRecord({ environment: envInput });
              }}
            />
            <input
              type="text"
              aria-label="Release owner"
              placeholder="Owner (e.g. Omar)"
              value={ownerInput}
              onChange={(event) => setOwnerInput(event.target.value)}
              onBlur={() => {
                if (ownerInput !== (record.releaseOwner ?? ""))
                  void saveRecord({ releaseOwner: ownerInput.trim() || null });
              }}
            />
          </div>
        </label>

        <label className="field small">
          <span className="muted">Repo version tag or commit SHA</span>
          <input
            type="text"
            aria-label="Target repo version or SHA"
            placeholder="e.g. v1.4.0 or sha-7f8a9b0"
            value={artifactInput}
            onChange={(event) => setArtifactInput(event.target.value)}
            onBlur={() => {
              if (artifactInput.trim() !== record.artifact)
                void saveRecord({ artifact: artifactInput.trim() });
            }}
          />
        </label>

        <label className="field small">
          <span className="muted">
            Rollback target &amp; Post-launch metric
          </span>
          <div className="row" style={{ gap: 6 }}>
            <input
              type="text"
              aria-label="Rollback target version"
              placeholder="Previous (e.g. v1.3.9)"
              value={rollbackTargetInput}
              onChange={(event) => setRollbackTargetInput(event.target.value)}
              onBlur={() => {
                if (
                  rollbackTargetInput.trim() !== (record.rollbackTarget ?? "")
                )
                  void saveRecord({
                    rollbackTarget: rollbackTargetInput.trim() || null,
                  });
              }}
            />
            <input
              type="text"
              aria-label="Post-launch metric"
              placeholder="e.g. 99.4% OK · 0 P1s"
              value={metricInput}
              onChange={(event) => setMetricInput(event.target.value)}
              onBlur={() => {
                const clean = metricInput.trim();
                if (clean !== (record.postLaunchMetrics[0]?.value ?? ""))
                  void saveRecord({
                    postLaunchMetrics: clean
                      ? [
                          {
                            name: "Post-launch check",
                            value: clean,
                            recordedAt: new Date().toISOString(),
                          },
                        ]
                      : [],
                  });
              }}
            />
          </div>
        </label>
      </div>

      {evaluation.staleArtifact && (
        <div
          className="rb-inline amber"
          role="alert"
          aria-label="Stale artifact guardrail"
        >
          <strong>Newer code in repo · Re-approve</strong>
          <span className="small">
            Approval covered <code>{record.approval?.approvedArtifact}</code>,
            but the target repo version is now <code>{record.artifact}</code>.
            Amun holds the release in Readiness until the new version is
            approved.
          </span>
          <div className="row wrap">
            <button
              className="btn primary"
              type="button"
              onClick={() =>
                void saveRecord({
                  approval: {
                    approvedBy: ownerInput.trim() || "Captain",
                    approvedArtifact: record.artifact,
                    approvedAt: new Date().toISOString(),
                  },
                  requestedState: "scheduled",
                })
              }
            >
              Approve {record.artifact} for release
            </button>
            {record.approval?.approvedArtifact && (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  const pinned = record.approval!.approvedArtifact;
                  setArtifactInput(pinned);
                  void saveRecord({ artifact: pinned });
                }}
              >
                Keep pinned to {record.approval.approvedArtifact}
              </button>
            )}
          </div>
        </div>
      )}

      {evaluation.failedSmoke && (
        <div
          className="rb-inline amber"
          role="alert"
          aria-label="Failed smoke check guardrail"
        >
          <strong>Failed smoke check · Verified live blocked</strong>
          <span className="small">
            {record.smokeCheck?.summary ??
              "Sanity/smoke check failed on the deployed version. Amun blocks Verified live until resolved or rolled back."}
          </span>
          <div className="row wrap">
            <button
              className="btn primary"
              type="button"
              onClick={() =>
                void saveRecord({
                  requestedState: "rolled_back",
                  rolledBackTo:
                    rollbackTargetInput.trim() ||
                    record.rollbackTarget ||
                    "previous version",
                  rollbackReason:
                    record.smokeCheck?.summary ?? "Failed smoke check",
                })
              }
            >
              Roll back to{" "}
              {rollbackTargetInput.trim() ||
                record.rollbackTarget ||
                "previous version"}
            </button>
          </div>
        </div>
      )}

      {live && doc && (
        <div className="rb-inline amber" role="group" aria-label="Close out">
          <span>
            <strong>{releaseName} is live.</strong>{" "}
            {shipped.length
              ? `Close out: mark its ${shipped.filter((item) => storyGroup(item.status) !== "done").length} unfinished stories Done.`
              : "No stories are linked to this release, so there is nothing to close out."}
          </span>
          {closeOut && <span className="small">{closeOut}</span>}
          <div className="row wrap">
            {shipped.length > 0 && (
              <button
                className="btn primary"
                type="button"
                onClick={async () => {
                  const result = await workAsync("close-out-release", {
                    releaseId: doc.id,
                  });
                  const step = result.step as {
                    closed?: number;
                    inTool?: { title: string; key: string | null }[];
                  } | null;
                  const inTool = step?.inTool ?? [];
                  setCloseOut(
                    !result.ok
                      ? result.message
                      : `${step?.closed ?? 0} stories kept in Amun are Done.` +
                          (inTool.length
                            ? ` ${inTool.length} in a tool (${inTool
                                .map((item) => item.key ?? item.title)
                                .join(
                                  ", ",
                                )}) close there: ask Firstmate to raise the plan.`
                            : ""),
                  );
                }}
              >
                Close out
              </button>
            )}
            <button
              className="btn"
              type="button"
              onClick={async () => {
                const result = await workAsync("mark-delivered", {
                  workAreaId,
                });
                setCloseOut(
                  result.ok
                    ? "Marked Delivered. The requirements show the date and this release."
                    : result.message,
                );
              }}
            >
              Mark requirements Delivered
            </button>
          </div>
        </div>
      )}

      {!live && (
        <div className="rb-inline" role="group" aria-label="Release readiness">
          <span>
            {shipped.length === 0 ? (
              "No stories are in this release yet."
            ) : (
              <>
                {shipped.length} {shipped.length === 1 ? "story" : "stories"} ·{" "}
                <strong>
                  {shipped.length - readiness.notDone.length} done
                </strong>
                {readiness.notDone.length > 0 && (
                  <> · {readiness.notDone.length} not done</>
                )}
              </>
            )}
            {anywayReason && (
              <span className="muted small">
                {" "}
                · Released anyway: {anywayReason}
              </span>
            )}
          </span>
          <div className="row wrap">
            {doc && shipped.length === 0 && workStories.length > 0 && (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  for (const story of workStories)
                    work("link-delivery", {
                      link: "release_story",
                      fromId: doc.id,
                      toId: story.id,
                      linked: true,
                    });
                }}
              >
                Include all {workStories.length} stories of this work
              </button>
            )}
            {doc && readiness.notDone.length > 0 && (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  for (const id of readiness.notDone)
                    work("link-delivery", {
                      link: "release_story",
                      fromId: doc.id,
                      toId: id,
                      linked: false,
                    });
                }}
              >
                Move {readiness.notDone.length} to the next release
              </button>
            )}
            {!gateOpen && anyway === null && (
              <button
                className="btn"
                type="button"
                onClick={() => setAnyway("")}
              >
                Release anyway…
              </button>
            )}
          </div>
          {anyway !== null && (
            <div className="row wrap">
              <input
                aria-label="Why release anyway"
                placeholder="Why release now? This is kept on the receipt."
                value={anyway}
                onChange={(event) => setAnyway(event.target.value)}
              />
              <button
                className="btn primary"
                type="button"
                disabled={!anyway.trim()}
                onClick={() => {
                  void saveRecord({
                    readinessEvidence: [
                      ...record.readinessEvidence,
                      `Released anyway: ${anyway.trim()}`,
                    ],
                  });
                  setAnyway(null);
                }}
              >
                Release anyway
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => setAnyway(null)}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      <div className="row wrap">
        <button
          className="btn"
          type="button"
          disabled={!artifactInput.trim() || !gateOpen || live}
          title={
            gateOpen
              ? undefined
              : "Schedule waits until the release's stories are done"
          }
          onClick={() => {
            const target = artifactInput.trim();
            void saveRecord({
              artifact: target,
              cancelledAt: null,
              rolledBackTo: null,
              approval: {
                approvedBy: ownerInput.trim() || "Captain",
                approvedArtifact: target,
                approvedAt: new Date().toISOString(),
              },
              requestedState: "scheduled",
            });
          }}
        >
          1. Approve &amp; schedule {artifactInput.trim() || "repo version"}
        </button>

        <button
          className="btn"
          type="button"
          disabled={!artifactInput.trim() || live}
          onClick={() =>
            void saveRecord({
              artifact: artifactInput.trim(),
              cancelledAt: null,
              requestedState: "deploying",
              deploymentId: `deploy-${new Date().toISOString().slice(0, 10)}`,
            })
          }
        >
          2. Mark deploying (repo or client site)
        </button>

        <button
          className="btn primary"
          type="button"
          disabled={!artifactInput.trim() || live}
          onClick={() => setShowReceiptForm(!showReceiptForm)}
        >
          3. Record release-owner receipt (Verify live)
        </button>

        <button
          className="btn quiet"
          type="button"
          disabled={!artifactInput.trim()}
          onClick={() => {
            const target = artifactInput.trim();
            void saveRecord({
              artifact: target,
              observedLiveVersion: target,
              smokeCheck: {
                status: "failed",
                checkedVersion: target,
                summary: `Sanity check failed on ${target} at ${envInput || "client site"}`,
                checkedAt: new Date().toISOString(),
              },
              manualReceipt: null,
              requestedState: "failed",
            });
          }}
        >
          Report failed smoke check
        </button>

        {record.requestedState === "scheduled" && !record.cancelledAt && (
          <button
            className="btn quiet"
            type="button"
            onClick={() =>
              void saveRecord({
                cancelledAt: new Date().toISOString().slice(0, 16),
                requestedState: "readiness",
              })
            }
          >
            Cancel scheduled release
          </button>
        )}
      </div>

      {showReceiptForm && (
        <form
          className="rb-inline"
          aria-label="Release-owner receipt"
          onSubmit={(event) => {
            event.preventDefault();
            const target = artifactInput.trim();
            if (!target) return;
            const ownerName = ownerInput.trim() || "Captain";
            void saveRecord({
              artifact: target,
              releaseOwner: ownerName,
              environment: envInput.trim() || "client site",
              cancelledAt: null,
              rolledBackTo: null,
              approval: record.approval ?? {
                approvedBy: ownerName,
                approvedArtifact: target,
                approvedAt: new Date().toISOString(),
              },
              observedLiveVersion: target,
              smokeCheck: {
                status: "passed",
                checkedVersion: target,
                summary: `Verified ${target} live at ${envInput.trim() || "client site"}`,
                checkedAt: new Date().toISOString(),
              },
              manualReceipt: {
                owner: ownerName,
                artifact: target,
                environment: envInput.trim() || "client site",
                liveVersion: target,
                smokePassed: true,
                recordedAt: new Date().toISOString(),
              },
              requestedState: "verified_live",
            });
            setShowReceiptForm(false);
          }}
        >
          <strong>
            Confirm release-owner receipt (Air-gapped client site or Repo
            deploy)
          </strong>
          <span className="small muted">
            Confirms that exact repo version{" "}
            <code>{artifactInput.trim() || "—"}</code> is installed at{" "}
            <b>{envInput.trim() || "client site"}</b> and passed its sanity /
            smoke check.
          </span>
          <div className="row wrap">
            <button className="btn primary" type="submit">
              Confirm exact version &amp; smoke check passed
            </button>
            <button
              className="btn quiet"
              type="button"
              onClick={() => setShowReceiptForm(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
