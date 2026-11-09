import { useState, useRef, useEffect } from "react";
import {
  deliveryChecklist,
  prResult,
  type WorkspaceSnapshot,
} from "@amun/contracts";
import { bridge } from "./bridge.ts";
type Result = ReturnType<typeof prResult.parse>;
function Diff({ value }: { value: { before: string; after: string } }) {
  const host = useRef<HTMLDivElement>(null);
  const [regions, count] = useState<number | null>(null);
  useEffect(() => {
    if (!host.current) return;
    globalThis.MonacoEnvironment = {
      getWorker: () =>
        new Worker(new URL("./diff-worker.js", document.baseURI)),
    };
    count(null);
    let disposed = false;
    let release: (() => void) | undefined;
    void import("monaco-editor/editor/editor.api.js").then(({ editor }) => {
      if (disposed) return;
      const before = editor.createModel(value.before, "plaintext"),
        after = editor.createModel(value.after, "plaintext");
      const view = editor.createDiffEditor(host.current!, {
        readOnly: true,
        originalEditable: false,
        automaticLayout: true,
        minimap: { enabled: false },
        renderSideBySide: true,
      });
      const observer = view.onDidUpdateDiff(() =>
        count(view.getLineChanges()?.length ?? null),
      );
      view.setModel({ original: before, modified: after });
      release = () => {
        observer.dispose();
        view.dispose();
        before.dispose();
        after.dispose();
      };
    });
    return () => {
      disposed = true;
      release?.();
    };
  }, [value]);
  return (
    <>
      <p aria-label="Diff summary">
        {regions === null
          ? "Computing differences…"
          : regions + " changed " + (regions === 1 ? "region" : "regions")}
      </p>
      <div className="pull-diff" aria-label="File comparison" ref={host} />
    </>
  );
}
export function PullWorkspace({
  context,
}: {
  context: NonNullable<WorkspaceSnapshot["productContext"]>;
}) {
  const [rows, setRows] = useState<NonNullable<Result["rows"]>>([]),
    [chosen, select] = useState<{ source: string; number: number } | null>(
      null,
    ),
    [detail, inspect] = useState<Result["detail"]>(),
    [diff, compare] = useState<Result["diff"]>(),
    [review, hold] = useState<Result["review"]>(),
    [status, notify] = useState(""),
    [busy, wait] = useState(false);
  const pending = useRef(""),
    product = context.productId;
  useEffect(
    () =>
      bridge.onEvent((raw) => {
        const r = prResult.safeParse(raw);
        if (!r.success) {
          if (
            raw &&
            typeof raw === "object" &&
            "kind" in raw &&
            raw.kind === "service-lost"
          ) {
            pending.current = "";
            wait(false);
            notify("Connection interrupted. Refresh to verify the operation.");
          }
          return;
        }
        const v = r.data;
        if (v.product !== product || v.id !== pending.current) return;
        wait(false);
        notify(v.message);
        if (v.rows) setRows(v.rows);
        if (v.detail) inspect(v.detail);
        if (v.diff) compare(v.diff);
        if (v.review) hold(v.review);
      }),
    [product],
  );
  const send = (action: string, args: Record<string, unknown> = {}) => {
    const id = crypto.randomUUID();
    pending.current = id;
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
  const open = (source: string, number: number) => {
    const next = { source, number };
    select(next);
    inspect(undefined);
    hold(undefined);
    compare(undefined);
    send("details", next);
  };
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
  const sources = context.sources.filter((s) => s.kind === "repo");
  return (
    <section aria-label="Pull request workspace">
      <h2>Pull requests</h2>
      {!sources.length ? (
        <p>Map a repository in Product context.</p>
      ) : (
        <>
          <button disabled={busy} onClick={() => send("list")}>
            Load repository PRs
          </button>
          <ul>
            {rows.map((r) => (
              <li key={r.source + "/" + r.number}>
                <button
                  disabled={busy}
                  onClick={() => open(r.source, r.number)}
                >
                  {r.provider} · {sources.find((s) => s.id === r.source)?.title}{" "}
                  #{r.number} · {r.title}
                </button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              open(String(f.get("source")), Number(f.get("number")));
            }}
          >
            <label>
              Repository
              <select name="source">
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              PR number
              <input type="number" name="number" min="1" required />
            </label>
            <button disabled={busy}>Open pull request</button>
          </form>
        </>
      )}
      {detail && chosen && (
        <article>
          <h3>{detail.title}</h3>
          <p>{detail.summary}</p>
          <p>
            Head {detail.head} · Base {detail.base}
          </p>
          {Object.entries({
            Checks: detail.checks,
            Reviews: detail.reviews,
            "Open threads": detail.threads,
          }).map(([label, items]) => (
            <details key={label}>
              <summary>
                {label} ({items.length})
              </summary>
              <ul>
                {items.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            </details>
          ))}
          <ul aria-label="Changed files">
            {detail.files.map((path) => (
              <li key={path}>
                <button
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
          {diff && <Diff value={diff} />}
          {detail.votes.length > 0 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                send("review", {
                  ...chosen,
                  head: detail.head,
                  vote: f.get("vote"),
                  body: f.get("body"),
                });
              }}
            >
              <label>
                Review action
                <select name="vote">
                  {detail.votes.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Review text
                <textarea name="body" required maxLength={10000} />
              </label>
              <button disabled={busy}>Submit PR review</button>
            </form>
          )}
          {!detail.merged && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send("prepare", {
                  ...chosen,
                  head: detail.head,
                  method: new FormData(e.currentTarget).get("method"),
                });
              }}
            >
              <label>
                Merge method
                <select name="method">
                  {detail.methods.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <button disabled={busy || !detail.ready || !detail.permitted}>
                Prepare merge
              </button>
            </form>
          )}
          {review && bound && (
            <section aria-label="Exact merge review">
              <p>
                {sources.find((s) => s.id === chosen.source)?.reference} · #
                {chosen.number} · {review.head} → {review.base} ·{" "}
                {review.method} · {review.state}
              </p>
              {review.state === "pending_approval" && (
                <button disabled={busy} onClick={() => send("approve", bound)}>
                  Approve merge
                </button>
              )}
              {["approved", "unknown"].includes(review.state) && (
                <button disabled={busy} onClick={() => send("execute", bound)}>
                  {review.state === "unknown"
                    ? "Verify merge outcome"
                    : "Execute approved merge"}
                </button>
              )}
              {review.decisions.map((d) => (
                <p key={d.at}>
                  {" "}
                  {d.story} · {d.verdict} · {d.rationale}
                </p>
              ))}
              {review.state === "succeeded" &&
                detail.merged &&
                !review.stories.length && (
                  <p>No delivery run links this revision to a story.</p>
                )}
              {review.state === "succeeded" &&
                detail.merged &&
                review.stories.length > 0 && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      send("accept", {
                        ...bound,
                        story: f.get("story"),
                        verdict: f.get("verdict"),
                        rationale: f.get("rationale"),
                        checks: f.getAll("checks"),
                      });
                    }}
                  >
                    <label>
                      Delivery story
                      <select name="story" required>
                        {review.stories.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    {deliveryChecklist.map((v) => (
                      <label key={v}>
                        <input
                          type="checkbox"
                          name="checks"
                          value={v}
                          required
                        />
                        {v}
                      </label>
                    ))}
                    <label>
                      Acceptance decision
                      <select name="verdict">
                        {["Accepted", "Rejected", "Blocked"].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Acceptance rationale
                      <input name="rationale" required maxLength={512} />
                    </label>
                    <button disabled={busy}>Record delivery decision</button>
                  </form>
                )}
            </section>
          )}
        </article>
      )}
      <p role="status">{busy ? "Contacting repository…" : status}</p>
    </section>
  );
}
