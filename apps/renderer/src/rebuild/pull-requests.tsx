import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  deliveryChecklist,
  prResult,
  type WorkspaceSnapshot,
} from "@amun/contracts";
import { bridge } from "../bridge.ts";
import { CodeChangeCards } from "./code-change-cards.tsx";
import {
  changeSummary,
  checksLabel,
  mergeStage,
  methodLabels,
  resultMessage,
  shortHead,
  changed,
  type Method,
} from "./pull-requests-model.ts";

const PullDiff = lazy(() =>
  import("./pull-diff.tsx").then((module) => ({ default: module.PullDiff })),
);
type Result = ReturnType<typeof prResult.parse>;
type Action =
  | "list"
  | "details"
  | "file"
  | "review"
  | "prepare"
  | "approve"
  | "execute"
  | "accept";
const voteLabels = {
  comment: "Leave a comment",
  approve: "Approve it",
  changes: "Ask for changes",
};

/**
 * Open pull requests for the repository connected to this project. Reading is
 * free; a merge is a plan the owner approves for one exact version.
 */
export function PullRequests({
  context,
  onAsk,
}: {
  context: NonNullable<WorkspaceSnapshot["productContext"]>;
  onAsk: (text: string) => void;
}) {
  const [rows, setRows] = useState<NonNullable<Result["rows"]>>([]),
    [loaded, setLoaded] = useState(false),
    [chosen, select] = useState<{ source: string; number: number } | null>(
      null,
    ),
    [detail, inspect] = useState<Result["detail"]>(),
    [diff, compare] = useState<Result["diff"]>(),
    [review, hold] = useState<Result["review"]>(),
    [status, notify] = useState(""),
    [busy, wait] = useState(false);
  const pending = useRef<{ id: string; action: Action }>({
      id: "",
      action: "list",
    }),
    product = context.productId,
    sources = context.sources.filter((s) => s.kind === "repo");

  const send = (action: Action, args: Record<string, unknown> = {}) => {
    const id = crypto.randomUUID();
    pending.current = { id, action };
    wait(true);
    bridge.send({
      version: 1,
      kind: "pr-workspace",
      product,
      id,
      action,
      ...args,
    });
  };

  useEffect(
    () =>
      bridge.onEvent((raw) => {
        const parsed = prResult.safeParse(raw);
        if (!parsed.success) {
          if (
            raw &&
            typeof raw === "object" &&
            "kind" in raw &&
            raw.kind === "service-lost"
          ) {
            pending.current = { id: "", action: "list" };
            wait(false);
            notify(
              "The connection was interrupted. Open the pull request again to check what happened.",
            );
          }
          return;
        }
        const v = parsed.data,
          { id, action } = pending.current;
        if (v.product !== product || v.id !== id) return;
        wait(false);
        const ok =
          action === "list"
            ? Boolean(v.rows)
            : action === "file"
              ? Boolean(v.diff)
              : action === "prepare"
                ? Boolean(v.review)
                : Boolean(v.detail);
        notify(resultMessage(action, ok, v.message, v.rows?.length));
        if (v.rows) {
          setRows(v.rows);
          setLoaded(true);
        }
        if (v.detail) inspect(v.detail);
        if (v.diff) compare(v.diff);
        if (v.review) hold(v.review);
        if (!ok && changed(v.message) && chosen)
          // The version moved on: show the new one next to the old plan.
          window.setTimeout(() => send("details", chosen), 0);
      }),
    // `chosen` is read when a result arrives.
    [product, chosen],
  );

  useEffect(() => {
    if (sources.length && !loaded) send("list");
    // Once per repository connection.
  }, [sources.length]);

  const open = (source: string, number: number) => {
    const next = { source, number };
    select(next);
    inspect(undefined);
    hold(undefined);
    compare(undefined);
    send("details", next);
  };
  const back = () => {
    select(null);
    inspect(undefined);
    hold(undefined);
    compare(undefined);
    send("list");
  };

  if (!sources.length)
    return (
      <div className="rb-inline amber">
        <strong>No repository is connected to this project yet.</strong>
        <span className="note">
          Tell Firstmate which GitHub repository it uses, for example “Use
          https://github.com/owner/repo for this project”.
        </span>
        <button
          className="btn"
          onClick={() => onAsk("Connect this project to the repository ")}
        >
          Ask Firstmate to connect one
        </button>
      </div>
    );

  const title = (source: string) =>
    sources.find((s) => s.id === source)?.title ?? "Repository";
  const bound =
    review && chosen
      ? {
          ...chosen,
          reviewId: review.id,
          binding: review.binding,
          method: review.method,
          base: review.base,
        }
      : null;
  const stage = detail && review ? mergeStage(review, detail) : "none";
  const statusLine = (
    <p className="muted small" role="status" aria-live="polite">
      {busy ? "Checking the repository…" : status}
    </p>
  );

  if (!chosen)
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div className="row">
          <h3 className="grow" style={{ margin: 0 }}>
            Pull requests
          </h3>
          <button
            className="btn quiet"
            disabled={busy}
            onClick={() => send("list")}
          >
            Refresh
          </button>
        </div>
        {statusLine}
        <CodeChangeCards product={product} onOpened={() => send("list")} />
        <div className="rb-rows">
          {rows.map((row) => {
            const checks = checksLabel(row.checks);
            return (
              <button
                key={row.source + "/" + row.number}
                className="rb-rowitem"
                disabled={busy}
                onClick={() => open(row.source, row.number)}
              >
                <span>
                  <span className="name">
                    #{row.number} {row.title}
                  </span>
                  <span className="muted small" style={{ display: "block" }}>
                    {row.author ? `${row.author} · ` : ""}
                    {sources.length > 1 ? `${title(row.source)} · ` : ""}
                    {row.draft ? "Draft" : "Ready for review"}
                  </span>
                </span>
                <span>
                  <span className={"tag " + checks.tone}>{checks.text}</span>
                </span>
                <span className="muted small">{changeSummary(row)}</span>
              </button>
            );
          })}
        </div>
      </div>
    );

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="row">
        <button className="btn quiet" disabled={busy} onClick={back}>
          All pull requests
        </button>
      </div>
      {statusLine}
      {detail && (
        <>
          <div style={{ display: "grid", gap: 4 }}>
            <h3 style={{ margin: 0 }}>
              #{chosen.number} {detail.title}
            </h3>
            <span className="muted small">
              {title(chosen.source)} · {detail.sourceBranch} into {detail.base}{" "}
              · version {shortHead(detail.head)}
            </span>
          </div>
          {detail.summary && <p>{detail.summary}</p>}
          {Object.entries({
            Checks: detail.checks,
            Reviews: detail.reviews,
            "Open comments": detail.threads,
          }).map(([label, items]) => (
            <details key={label}>
              <summary>
                {label} ({items.length})
              </summary>
              <ul>
                {items.map((value, index) => (
                  <li key={index}>{value}</li>
                ))}
              </ul>
            </details>
          ))}
          <div style={{ display: "grid", gap: 6 }}>
            <strong>
              Changed files ({detail.files.length}
              {detail.files.length >= 300 ? "+" : ""})
            </strong>
            <ul aria-label="Changed files" style={{ margin: 0 }}>
              {detail.files.map((path) => (
                <li key={path}>
                  <button
                    className="link small"
                    disabled={busy}
                    onClick={() =>
                      send("file", { ...chosen, path, head: detail.head })
                    }
                  >
                    {path}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {diff && (
            <Suspense
              fallback={
                <p className="muted" role="status">
                  Opening the comparison…
                </p>
              }
            >
              <PullDiff value={diff} />
            </Suspense>
          )}
          {detail.votes.length > 0 && (
            <details>
              <summary>Write a review</summary>
              <form
                style={{ display: "grid", gap: 10, marginTop: 8 }}
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  send("review", {
                    ...chosen,
                    head: detail.head,
                    vote: form.get("vote"),
                    body: form.get("body"),
                  });
                }}
              >
                <label className="field">
                  <span>What would you like to do?</span>
                  <select name="vote">
                    {detail.votes.map((vote) => (
                      <option key={vote} value={vote}>
                        {voteLabels[vote]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Your review</span>
                  <textarea name="body" required maxLength={10000} />
                </label>
                <span className="note small">
                  This is sent to the repository as you.
                </span>
                <button className="btn" disabled={busy}>
                  Send my review
                </button>
              </form>
            </details>
          )}
          {!detail.merged && stage === "none" && (
            <form
              className="rb-inline"
              onSubmit={(event) => {
                event.preventDefault();
                send("prepare", {
                  ...chosen,
                  head: detail.head,
                  method: new FormData(event.currentTarget).get("method"),
                });
              }}
            >
              <strong>Merge this pull request</strong>
              <span className="note">
                Firstmate writes a merge plan for version{" "}
                {shortHead(detail.head)}. Nothing is merged until you approve
                it.
              </span>
              <label className="field">
                <span>How to merge</span>
                <select name="method">
                  {detail.methods.map((method) => (
                    <option key={method} value={method}>
                      {methodLabels[method]}
                    </option>
                  ))}
                </select>
              </label>
              {!detail.permitted ? (
                <span className="note">
                  Your GitHub account can’t merge in this repository.
                </span>
              ) : !detail.ready ? (
                <span className="note">
                  Not ready yet: it needs passing checks, no conflicts and to be
                  out of draft.
                </span>
              ) : null}
              <button
                className="btn"
                disabled={busy || !detail.ready || !detail.permitted}
              >
                Ask Firstmate for a merge plan
              </button>
            </form>
          )}
          {review && bound && stage !== "none" && (
            <section
              className={"rb-inline" + (stage === "merged" ? "" : " amber")}
              aria-label="Merge plan"
            >
              <strong>
                {stage === "merged" ? "Merged" : "Merge plan from Firstmate"}
              </strong>
              <span>
                {sources.find((s) => s.id === chosen.source)?.reference}
              </span>
              <span className="muted small">
                Pull request #{chosen.number} · version {shortHead(review.head)}{" "}
                into {review.base} · {methodLabels[review.method as Method]}
              </span>
              {stage === "approve" && (
                <>
                  <span className="note">
                    Nothing is merged until you approve this exact version.
                  </span>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => send("approve", bound)}
                  >
                    Approve this merge
                  </button>
                </>
              )}
              {stage === "merge" && (
                <>
                  <span className="note">
                    Approved. It merges only if the pull request is still this
                    version.
                  </span>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => send("execute", bound)}
                  >
                    Merge now
                  </button>
                </>
              )}
              {stage === "verify" && (
                <>
                  <span className="note">
                    We couldn’t confirm whether this merged.
                  </span>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => send("execute", bound)}
                  >
                    Check the result
                  </button>
                </>
              )}
              {stage === "stale" && (
                <>
                  <span role="alert">
                    <span className="tag warn">Changed since you reviewed</span>{" "}
                    New changes arrived after this plan, so it can’t be used.
                    Nothing was merged.
                  </span>
                  {!detail.merged && detail.ready && detail.permitted && (
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        send("prepare", {
                          ...chosen,
                          head: detail.head,
                          method: detail.methods.includes(
                            review.method as Method,
                          )
                            ? review.method
                            : detail.methods[0],
                        })
                      }
                    >
                      Plan the merge again for version {shortHead(detail.head)}
                    </button>
                  )}
                </>
              )}
              {review.decisions.map((entry) => (
                <span key={entry.at} className="muted small">
                  {entry.story} · {entry.verdict} · {entry.rationale}
                </span>
              ))}
              {stage === "merged" && !review.stories.length && (
                <span className="note">
                  No delivery work is linked to this version yet.
                </span>
              )}
              {stage === "merged" && review.stories.length > 0 && (
                <form
                  style={{ display: "grid", gap: 10 }}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    send("accept", {
                      ...bound,
                      story: form.get("story"),
                      verdict: form.get("verdict"),
                      rationale: form.get("rationale"),
                      checks: form.getAll("checks"),
                    });
                  }}
                >
                  <span className="note">
                    Merging is not acceptance. Record your decision on the story
                    separately.
                  </span>
                  <label className="field">
                    <span>Story</span>
                    <select name="story" required>
                      {review.stories.map((story) => (
                        <option key={story.id} value={story.id}>
                          {story.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {deliveryChecklist.map((check) => (
                    <label key={check} className="row">
                      <input
                        type="checkbox"
                        name="checks"
                        value={check}
                        required
                      />
                      {check}
                    </label>
                  ))}
                  <label className="field">
                    <span>Your decision</span>
                    <select name="verdict">
                      {["Accepted", "Rejected", "Blocked"].map((verdict) => (
                        <option key={verdict}>{verdict}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Why, in a few words</span>
                    <input name="rationale" required maxLength={512} />
                  </label>
                  <button className="btn" disabled={busy}>
                    Save my decision
                  </button>
                </form>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
