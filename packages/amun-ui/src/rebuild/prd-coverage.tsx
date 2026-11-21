import { StoryDraftEditor } from "./story-draft-editor.tsx";
import {
  ReviewBacklogPicker,
  type ReviewBoard,
} from "./review-backlog-picker.tsx";
import { useEffect, useRef, useState } from "react";
import { operationResult, type WorkspaceSnapshot } from "@amun/contracts";
import { bridge } from "../bridge.ts";
import { browserStore, readBoard, readSource } from "../backlog-selection.ts";
import { newRequestRef } from "../../../domain/src/work/requests.ts";
import { useReviewOrigin } from "./review-origin.tsx";
import { inspectView } from "../daemon/navigation.ts";

type Context = NonNullable<WorkspaceSnapshot["productContext"]>;
export function PrdCoverage({
  context,
  objectiveId,
  version,
}: {
  context: Context;
  objectiveId: string;
  version: number;
}) {
  const origin = useReviewOrigin();
  const sources = context.sources.filter((source) => source.kind === "ado");
  const reviewKey = JSON.stringify([
    context.productId,
    objectiveId,
    version,
    origin?.areaId,
    origin?.chatId,
  ]);
  const [choice, setChoice] = useState<{
    key: string;
    board: ReviewBoard;
  } | null>(null);
  const override =
    choice?.key === reviewKey &&
    sources.some((s) => s.id === choice.board.sourceId)
      ? choice.board
      : null;
  const sourceId =
    override?.sourceId ??
    readSource(
      browserStore(),
      context.productId,
      sources.map((s) => s.id),
    );
  const board =
    override ??
    (sourceId
      ? readBoard(browserStore(), context.productId, sourceId)
      : undefined);
  const comparison = context.comparisons?.find(
    (c) =>
      c.objectiveId === objectiveId &&
      c.version === version &&
      c.sourceId === sourceId &&
      c.team === board?.team &&
      c.level === board?.level,
  );
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef("");
  useEffect(() => {
    const stop = bridge.onEvent((event) => {
      const parsed = operationResult.safeParse(event);
      if (
        !pending.current ||
        !parsed.success ||
        parsed.data.requestId !== pending.current ||
        parsed.data.productId !== context.productId
      )
        return;
      pending.current = "";
      setBusy(false);
      setStatus(parsed.data.message);
    });
    return stop;
  }, [context.productId]);
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => {
      pending.current = "";
      setBusy(false);
      setStatus(
        "Firstmate has not confirmed the comparison. Reopen the review to check its saved result.",
      );
    }, 180000);
    return () => clearTimeout(timer);
  }, [busy]);
  const submit = () => {
    if (!origin || !board || !sourceId || pending.current) return;
    pending.current = crypto.randomUUID();
    setBusy(true);
    setStatus("Comparing the selected backlog…");
    bridge.send({
      version: 1,
      kind: "ado-operation",
      action: "compare-prd",
      ref: newRequestRef(),
      requestId: pending.current,
      workAreaId: origin.areaId,
      chatId: origin.chatId,
      productId: context.productId,
      objectiveId,
      versionNumber: version,
      sourceId,
      team: board.team,
      level: board.level,
    });
  };
  return (
    <section className="rb-inline" aria-label="Backlog comparison">
      <h4>Backlog comparison</h4>
      {!!sources.length && !busy && (
        <ReviewBacklogPicker
          key={reviewKey}
          productId={context.productId}
          sources={sources}
          choose={(board) => {
            setChoice({ key: reviewKey, board });
            setStatus("");
          }}
        />
      )}
      {!board?.level ? (
        <p className="muted">
          Backlog comparison pending. Choose a connected project, team and
          backlog.
        </p>
      ) : (
        <>
          <p className="muted small">
            {sources.find((s) => s.id === sourceId)?.title} · {board.team} ·{" "}
            {board.level}
          </p>
          <button className="btn" disabled={busy || !origin} onClick={submit}>
            {comparison ? "Refresh comparison" : "Compare with backlog"}
          </button>
        </>
      )}
      {status && <p role="status">{status}</p>}
      {comparison && (
        <>
          <p className="muted small">
            {comparison.pending &&
              "Comparison incomplete · last verified results. "}
            Last compared {new Date(comparison.verifiedAt).toLocaleString()}
          </p>
          {(["covered", "edit", "addition", "held"] as const).map(
            (category) => {
              const rows = comparison.rows.filter(
                (r) => r.classification === category,
              );
              if (!rows.length) return null;
              return (
                <details
                  key={category}
                  onToggle={(e) => {
                    if (e.currentTarget.open)
                      inspectView({
                        view: "PRD comparison " + category,
                        areaId: origin?.areaId ?? "",
                        record: comparison.ref,
                        source: sourceId,
                      });
                  }}
                >
                  <summary>
                    {
                      {
                        covered: "Covered requirements",
                        edit: "Proposed edits",
                        addition: "New stories",
                        held: "Needs review",
                      }[category]
                    }{" "}
                    ({rows.length})
                  </summary>
                  {rows.map((row) => (
                    <article key={row.draftId} className="rb-inline">
                      <strong>
                        {
                          context.storyDrafts.find((s) => s.id === row.draftId)
                            ?.title
                        }
                      </strong>
                      <p>{row.reason}</p>
                      {row.providerId !== null && (
                        <p className="muted small">
                          #{row.providerId} · revision {row.revision}
                        </p>
                      )}
                      {row.classification === "covered" &&
                        row.providerId &&
                        !comparison.pending && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const form = e.currentTarget;
                              const note = String(
                                new FormData(form).get("gap") ?? "",
                              ).trim();
                              const story = context.storyDrafts.find(
                                  (s) => s.id === row.draftId,
                                ),
                                model = context.allowedModels[0];
                              if (
                                !note ||
                                !origin ||
                                !story ||
                                !model ||
                                !board ||
                                form.dataset.sent === "true"
                              )
                                return;
                              form.dataset.sent = "true";
                              setStatus(
                                "Firstmate is drafting the missing criterion.",
                              );
                              bridge.send({
                                version: 1,
                                kind: "product-authoring",
                                action: "flag-coverage-gap",
                                productId: context.productId,
                                objectiveId,
                                expectedVersion: version,
                                origin,
                                model,
                                sourceId,
                                team: board.team,
                                level: board.level,
                                comparisonRef: comparison.ref,
                                providerId: row.providerId,
                                itemId: story.id,
                                baseline: {
                                  title: story.title,
                                  acceptance: story.acceptance,
                                },
                                note,
                              });
                            }}
                          >
                            <label className="field">
                              Missing case
                              <textarea
                                name="gap"
                                required
                                maxLength={2048}
                                onChange={(e) => {
                                  if (e.target.form)
                                    delete e.target.form.dataset.sent;
                                }}
                              />
                            </label>
                            <button
                              className="btn quiet"
                              disabled={
                                !origin || !context.allowedModels.length
                              }
                            >
                              Draft correction
                            </button>
                          </form>
                        )}
                      {row.classification === "edit" &&
                        context.storyDrafts
                          .filter((s) => s.id === row.draftId)
                          .map((story) => (
                            <div key={story.id}>
                              <ul>
                                {story.acceptance.map((criterion, i) => (
                                  <li key={i}>{criterion}</li>
                                ))}
                              </ul>
                              <StoryDraftEditor
                                context={context}
                                story={story}
                              />
                            </div>
                          ))}
                      {row.evidence && <blockquote>{row.evidence}</blockquote>}
                    </article>
                  ))}
                </details>
              );
            },
          )}
        </>
      )}
    </section>
  );
}
