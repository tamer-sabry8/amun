import { useEffect, useRef, useState } from "react";
import {
  operationResult,
  type AzureProcessSchema,
  type WorkspaceSnapshot,
} from "@amun/contracts";
import { bridge } from "./bridge.ts";
type Context = NonNullable<WorkspaceSnapshot["productContext"]>;
type Scope = { productId: string; sourceId: string; team: string };
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
    <section aria-label="Azure work review">
      <h3>Publication and sprint review</h3>
      {!held && (
        <>
          <button disabled={op.busy} onClick={() => op.send("targets", {})}>
            Load sprint targets and latest review
          </button>
          <form
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
            <label>
              Operation
              <select
                value={intent}
                onChange={(e) => {
                  intend(e.target.value);
                  op.clear();
                }}
              >
                <option value="publish">Publish backlog</option>
                <option value="commit">Commit sprint</option>
              </select>
            </label>
            <label>
              Area path
              <select name="area">
                {schema.areas.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
            {intent === "commit" && (
              <>
                <label>
                  Sprint iteration
                  <select required name="iteration">
                    <option value="">Select iteration…</option>
                    {iterations.map((i) => (
                      <option key={i}>{i}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Manual assignee (optional)
                  <input name="assignee" />
                </label>
              </>
            )}
            {drafts.map((d) => (
              <fieldset key={d.id}>
                <legend>
                  <label>
                    <input type="checkbox" name={"select-" + d.id} />
                    {d.title}
                  </label>
                </legend>
                <p>
                  PRD v{d.version} · {d.requirementId}
                </p>
                {intent === "publish" && (
                  <>
                    <label>
                      Azure title
                      <input
                        required
                        name={"title-" + d.id}
                        defaultValue={d.title}
                      />
                    </label>
                    <label>
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
                    <label>
                      Additional Azure fields (JSON)
                      <textarea name={"fields-" + d.id} defaultValue="{}" />
                    </label>
                  </>
                )}
              </fieldset>
            ))}
            <button disabled={op.busy || !drafts.length}>
              Preview {intent === "publish" ? "publication" : "commitment"}
            </button>
          </form>
        </>
      )}
      {held && (
        <>
          <pre aria-label="Exact Azure preview">{held.preview}</pre>
          <button
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
              disabled={op.busy}
              onClick={() =>
                op.send("approve-execute", {
                  batchId: held.id,
                  binding: held.binding,
                })
              }
            >
              Approve and execute reviewed{" "}
              {JSON.parse(held.preview).intent === "commit"
                ? "commitment"
                : "publication"}
            </button>
          )}
          {op.result?.receipts?.some((r) =>
            ["unknown", "approved", "executing"].includes(r.state),
          ) && (
            <button
              disabled={op.busy}
              onClick={() =>
                op.send("reconcile", {
                  batchId: held.id,
                  binding: held.binding,
                })
              }
            >
              Reconcile and continue
            </button>
          )}
        </>
      )}
      {op.result?.receipts && (
        <ul aria-label="Azure receipts">
          {op.result.receipts.map((r) => (
            <li key={r.itemId}>
              {context.storyDrafts.find((d) => d.id === r.itemId)?.title} ·{" "}
              {r.state}
              {r.remoteId ? " · #" + r.remoteId + " rev " + r.remoteRev : ""}
            </li>
          ))}
        </ul>
      )}
      <p role="status">{op.busy ? "Working…" : error || op.result?.message}</p>
    </section>
  );
}
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
      <summary>Edit #{card.id}</summary>
      <label>
        Item title
        <input
          value={title}
          disabled={review}
          onChange={(e) => rename(e.target.value)}
        />
      </label>
      <label>
        Board column
        <select
          disabled={review}
          value={column}
          onChange={(e) => move(e.target.value)}
        >
          <option value="">Select column…</option>
          {columns
            .filter((c) => c.stateMappings[card.type])
            .map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
        </select>
      </label>
      {review ? (
        <>
          <p>
            #{card.id} · revision {card.rev} · {title} · {column} ·{" "}
            {columns.find((c) => c.name === column)?.stateMappings[card.type]}
          </p>
          <button disabled={op.busy} onClick={() => setReview(false)}>
            Keep editing
          </button>
          <button
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
            Save reviewed edit
          </button>
        </>
      ) : (
        <button
          disabled={!title.trim() || !column}
          onClick={() => setReview(true)}
        >
          Review edit
        </button>
      )}
      <p role="status">{op.result?.message}</p>
    </details>
  );
}
