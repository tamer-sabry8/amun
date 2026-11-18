import type { WorkspaceSnapshot } from "@amun/contracts";
import { bridge } from "./bridge.ts";
export function ModelRoutes({
  context,
}: {
  context: NonNullable<WorkspaceSnapshot["productContext"]>;
}) {
  const send = (action: string, values: Record<string, string>) =>
    bridge.send({
      version: 1,
      kind: "workspace",
      action,
      productId: context.productId,
      ...values,
    });
  return (
    <details>
      <summary>Model routing</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          send("save-model-route", {
            task: String(f.get("task")),
            difficulty: String(f.get("difficulty")),
            model: String(f.get("model")).trim(),
          });
        }}
      >
        <label>
          Routing task
          <select name="task">
            {["conversation", "authoring", "stories", "decision"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Routing difficulty
          <select name="difficulty">
            <option>standard</option>
            <option>complex</option>
          </select>
        </label>
        <label>
          Route model ID
          <input name="model" required maxLength={256} />
        </label>
        <button>Save route</button>
      </form>
      <ul aria-label="Saved model routes">
        {context.routes.map((r) => (
          <li key={r.task + r.difficulty}>
            {r.task} · {r.difficulty} · {r.model}
          </li>
        ))}
      </ul>
      <ul aria-label="Verified model runs">
        {context.modelRuns.map((r) => (
          <li key={r.id}>
            {r.task} · {r.model}
          </li>
        ))}
      </ul>
      {context.routingReviews.map((r) => (
        <div key={r.id}>
          <p>
            Allow {r.model} for this product and route {r.task} ({r.difficulty})
            to it.
          </p>
          <button
            onClick={() =>
              send("approve-model-route", {
                reviewId: r.id,
                binding: r.binding,
              })
            }
          >
            Approve model route
          </button>
        </div>
      ))}
    </details>
  );
}
