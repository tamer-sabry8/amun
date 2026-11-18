import { useEffect, useRef, useState } from "react";
import {
  operationResult,
  type AzureProcessSchema,
  type WorkspaceSnapshot,
} from "@amun/contracts";
import { bridge } from "../bridge.ts";
import { code, divided, list, Problem, stack } from "./view-parts.tsx";

type Context = NonNullable<WorkspaceSnapshot["productContext"]>;
export type Scope = { productId: string; sourceId: string; team: string };

function useOperation(scope: Scope) {
  const id = useRef(""),
    [result, setResult] = useState<ReturnType<typeof operationResult.parse>>(),
    [busy, setBusy] = useState(false);
  useEffect(
    () =>
      bridge.onEvent((raw) => {
        if (
          raw &&
          typeof raw === "object" &&
          "kind" in raw &&
          raw.kind === "service-lost"
        ) {
          id.current = "";
          setBusy(false);
          setResult(undefined);
          return;
        }
        const parsed = operationResult.safeParse(raw);
        if (
          parsed.success &&
          parsed.data.productId === scope.productId &&
          parsed.data.requestId === id.current
        ) {
          setResult(parsed.data);
          setBusy(false);
          bridge.send({ version: 1, kind: "workspace", action: "snapshot" });
        }
      }),
    [scope.productId],
  );
  return {
    result,
    busy,
    send: (action: string, fields: Record<string, unknown>) => {
      id.current = crypto.randomUUID();
      setBusy(true);
      bridge.send({
        version: 1,
        kind: "ado-operation",
        ...scope,
        action,
        requestId: id.current,
        ...fields,
      });
    },
    clear: () => setResult(undefined),
  };
}

/** Publish draft stories to the backlog, or commit them to a sprint, after an exact preview. */
export function AzureWorkReview({
  scope,
  context,
  schema,
}: {
  scope: Scope;
  context: Context;
  schema: AzureProcessSchema;
}) {
  const op = useOperation(scope);
  const [intent, intend] = useState("publish"),
    [iterations, setIterations] = useState<string[]>([]),
    [error, setError] = useState(""),
    [held, hold] = useState<{ id: string; binding: string; preview: string }>();
  const source = context.sources.find((s) => s.id === scope.sourceId);
  const project = source?.reference
    ? decodeURIComponent(
        new URL(source.reference).pathname.split("/").filter(Boolean).at(-1)!,
      )
    : "";
  useEffect(() => {
    const r = op.result;
    if (r?.iterations) setIterations(r.iterations);
    if (r?.batchId && r.binding && r.preview)
      hold({ id: r.batchId, binding: r.binding, preview: r.preview });
  }, [op.result]);
  const drafts = context.storyDrafts.filter((d) =>
    intent === "publish"
      ? d.status === "draft"
      : d.status === "published" || d.status === "committed",
  );
  return (
    <section className="rb-inline" aria-label="Azure work review">
      <h3>Publish stories and plan a sprint</h3>
      {!held && (
        <>
          <div className="row">
            <button
              className="btn"
              disabled={op.busy}
              onClick={() => op.send("targets", {})}
            >
              Find sprints
            </button>
          </div>
          <form
            style={stack}
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              try {
                const items = drafts
                  .filter((d) => data.has("select-" + d.id))
                  .map((d) => ({
                    id: d.id,
                    type: data.get("type-" + d.id) ?? d.type,
                    title: data.get("title-" + d.id) ?? d.title,
                    fields: JSON.parse(
                      String(data.get("fields-" + d.id) || "{}"),
                    ),
                  }));
                if (!items.length) throw Error("Select at least one item.");
                setError("");
                op.send("preview", {
                  intent,
                  area: String(data.get("area")),
                  iteration:
                    intent === "publish"
                      ? project
                      : String(data.get("iteration")),
                  assignee:
                    intent === "commit"
                      ? String(data.get("assignee") ?? "")
                      : "",
                  items,
                });
              } catch (err) {
                setError(
                  err instanceof SyntaxError
                    ? "Enter valid JSON for additional fields."
                    : String(err),
                );
              }
            }}
          >
            <label className="field">
              What would you like to do?
              <select
                value={intent}
                onChange={(e) => {
                  intend(e.target.value);
                  op.clear();
                }}
              >
                <option value="publish">Publish to the backlog</option>
                <option value="commit">Commit to a sprint</option>
              </select>
            </label>
            <label className="field">
              Area
              <select name="area">
                {schema.areas.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
            {intent === "commit" && (
              <>
                <label className="field">
                  Sprint
                  <select required name="iteration">
                    <option value="">Choose a sprint…</option>
                    {iterations.map((i) => (
                      <option key={i}>{i}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Assign to (optional)
                  <input type="text" name="assignee" />
                </label>
              </>
            )}
            {drafts.map((d) => (
              <div
                key={d.id}
                role="group"
                aria-labelledby={"pick-" + d.id}
                style={divided}
              >
                <label className="row" id={"pick-" + d.id}>
                  <input type="checkbox" name={"select-" + d.id} />
                  {d.title}
                </label>
                <p className="muted small">
                  PRD v{d.version} · {d.requirementId}
                </p>
                {intent === "publish" && (
                  <>
                    <label className="field">
                      Title in Azure DevOps
                      <input
                        type="text"
                        required
                        name={"title-" + d.id}
                        defaultValue={d.title}
                      />
                    </label>
                    <label className="field">
                      Work item type
                      <select
                        name={"type-" + d.id}
                        defaultValue={
                          schema.types.find(
                            (t) => t.name.toLowerCase() === d.type,
                          )?.name ??
                          schema.types.find((t) =>
                            [
                              "Product Backlog Item",
                              "User Story",
                              "Issue",
                            ].includes(t.name),
                          )?.name
                        }
                      >
                        {schema.types.map((t) => (
                          <option key={t.name}>{t.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Extra fields, written as JSON
                      <textarea
                        name={"fields-" + d.id}
                        defaultValue="{}"
                        style={{ minHeight: 60, resize: "vertical" }}
                      />
                    </label>
                  </>
                )}
              </div>
            ))}
            {!drafts.length && (
              <p className="muted small">
                {intent === "publish"
                  ? "No story drafts are waiting to be published."
                  : "No published stories are waiting for a sprint."}
              </p>
            )}
            <div className="row">
              <button className="btn" disabled={op.busy || !drafts.length}>
                {intent === "publish"
                  ? "Preview what will be published"
                  : "Preview what will be committed"}
              </button>
            </div>
          </form>
        </>
      )}
      {held && (
        <>
          <p className="muted small">
            This is exactly what will be sent to Azure DevOps.
          </p>
          <pre aria-label="Exact Azure preview" style={code}>
            {held.preview}
          </pre>
          <div className="row wrap">
            <button
              className="btn quiet"
              disabled={op.busy}
              onClick={() => {
                hold(undefined);
                op.clear();
              }}
            >
              Close review
            </button>
            {op.result?.receipts?.every(
              (r) => r.state === "pending_approval",
            ) && (
              <button
                className="btn"
                disabled={op.busy}
                onClick={() =>
                  op.send("approve-execute", {
                    batchId: held.id,
                    binding: held.binding,
                  })
                }
              >
                {JSON.parse(held.preview).intent === "commit"
                  ? "Approve and commit"
                  : "Approve and publish"}
              </button>
            )}
            {op.result?.receipts?.some((r) =>
              ["unknown", "approved", "executing"].includes(r.state),
            ) && (
              <button
                className="btn"
                disabled={op.busy}
                onClick={() =>
                  op.send("reconcile", {
                    batchId: held.id,
                    binding: held.binding,
                  })
                }
              >
                Check what happened and continue
              </button>
            )}
          </div>
        </>
      )}
      {op.result?.receipts && (
        <ul aria-label="Azure receipts" style={list}>
          {op.result.receipts.map((r) => (
            <li key={r.itemId}>
              {context.storyDrafts.find((d) => d.id === r.itemId)?.title} ·{" "}
              {r.state}
              {r.remoteId
                ? " · #" + r.remoteId + " version " + r.remoteRev
                : ""}
            </li>
          ))}
        </ul>
      )}
      <Problem>{error}</Problem>
      <p className="muted small" role="status">
        {op.busy ? "Working…" : error ? "" : op.result?.message}
      </p>
    </section>
  );
}

/** Rename an item or move it to another board column, after a review step. */
export function CardEdit({
  scope,
  level,
  card,
  columns,
}: {
  scope: Scope;
  level: string;
  card: {
    id: number;
    rev: number;
    title: string;
    type: string;
    column: string | null;
  };
  columns: { name: string; stateMappings: Record<string, string> }[];
}) {
  const op = useOperation(scope);
  const [title, rename] = useState(card.title),
    [column, move] = useState(card.column ?? ""),
    [review, setReview] = useState(false);
  return (
    <details>
      <summary className="link small">Edit #{card.id}</summary>
      <div style={{ ...stack, marginTop: 8, maxWidth: "60ch" }}>
        <label className="field">
          Item title
          <input
            type="text"
            value={title}
            disabled={review}
            onChange={(e) => rename(e.target.value)}
          />
        </label>
        <label className="field">
          Board column
          <select
            disabled={review}
            value={column}
            onChange={(e) => move(e.target.value)}
          >
            <option value="">Choose a column…</option>
            {columns
              .filter((c) => c.stateMappings[card.type])
              .map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
          </select>
        </label>
        {review ? (
          <>
            <p className="muted small">
              This will save #{card.id} as “{title}” in {column}, with the state{" "}
              {columns.find((c) => c.name === column)?.stateMappings[card.type]}
              .
            </p>
            <div className="row wrap">
              <button
                className="btn quiet"
                disabled={op.busy}
                onClick={() => setReview(false)}
              >
                Keep editing
              </button>
              <button
                className="btn"
                disabled={op.busy}
                onClick={() =>
                  op.send("edit", {
                    itemId: card.id,
                    revision: card.rev,
                    title,
                    column,
                    level,
                  })
                }
              >
                Save edit
              </button>
            </div>
          </>
        ) : (
          <div className="row">
            <button
              className="btn"
              disabled={!title.trim() || !column}
              onClick={() => setReview(true)}
            >
              Review edit
            </button>
          </div>
        )}
        <p className="muted small" role="status">
          {op.result?.message}
        </p>
      </div>
    </details>
  );
}
