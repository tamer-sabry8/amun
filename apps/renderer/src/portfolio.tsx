import type { WorkspaceSnapshot } from "@amun/contracts";
import { bridge } from "./bridge.ts";

export function Portfolio({
  summary,
}: {
  summary: NonNullable<WorkspaceSnapshot["portfolio"]>;
}) {
  return (
    <section aria-label="Portfolio overview">
      <h2>Portfolio overview</h2>
      <div className="artifact-grid">
        {summary.products.map((p) => (
          <article className="artifact-card" key={p.id}>
            <h3>{p.name}</h3>
            <h4>Work item progress</h4>
            {p.progress.length ? (
              <ul>
                {p.progress.map((s) => (
                  <li key={s.status}>
                    {s.count} {s.status}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No work items</p>
            )}
            <h4>Blockers</h4>
            {p.blockers.length ? (
              <ul>
                {p.blockers.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            ) : (
              <p>No recorded blockers</p>
            )}
            <h4>Pending decisions</h4>
            {p.decisions.length ? (
              <ul>
                {p.decisions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            ) : (
              <p>No pending decisions</p>
            )}
          </article>
        ))}
      </div>
      <h3>Dependencies</h3>
      {summary.dependencies.length ? (
        <ul>
          {summary.dependencies.map((d) => (
            <li key={d.key}>
              <strong>
                {d.left} and {d.right}
              </strong>{" "}
              · Shared repository {d.reference} ·{" "}
              {d.confirmed ? "Confirmed" : "Inferred (unconfirmed)"}{" "}
              {!d.confirmed && (
                <button
                  onClick={() =>
                    bridge.send({
                      version: 1,
                      kind: "workspace",
                      action: "confirm-dependency",
                      key: d.key,
                    })
                  }
                >
                  Confirm dependency
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>No identified dependencies</p>
      )}
    </section>
  );
}
