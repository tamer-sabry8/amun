import { useState } from "react";
import type { StoryDecision, WorkspaceSnapshot } from "@amun/contracts";
import { bridge } from "./bridge.ts";
type Context = NonNullable<WorkspaceSnapshot["productContext"]>;
export function DecisionReview({
  decision: d,
  productId,
}: {
  decision: StoryDecision;
  productId: string;
}) {
  const [choice, setChoice] = useState(d.choice || d.proposed),
    [confirmation, setConfirmation] = useState(d.confirmation);
  const send = (operation: string) =>
    bridge.send({
      version: 1,
      kind: "workspace",
      action: "review-story-decision",
      productId,
      requestId: d.id,
      operation,
      choice,
      confirmation,
    });
  return (
    <section aria-label="Story decision">
      <h4>{d.question}</h4>
      <p>Firstmate proposal (Unapproved) · {d.proposed}</p>
      {d.state === "resolved" ? (
        <p>Resolved · {d.choice}</p>
      ) : (
        <>
          <label>
            Decision option
            <select value={choice} onChange={(e) => setChoice(e.target.value)}>
              {d.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <p>
            {d.requested ? "Confirmation requested" : "Missing confirmation"} ·{" "}
            {d.missing || "None"}
          </p>
          <label>
            Confirmation evidence
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <button onClick={() => send("save")}>Save proposed answer</button>
          <button onClick={() => send("request")}>Request confirmation</button>
          <button onClick={() => send("later")}>Later</button>
          <button
            disabled={!!d.missing && !confirmation.trim()}
            onClick={() => send("resolve")}
          >
            Resolve decision
          </button>
        </>
      )}
    </section>
  );
}
export function StoryBlockers({ context }: { context: Context }) {
  const blockers = context.storyDecisions.filter((d) => d.state !== "resolved");
  return (
    <section aria-label="Story blockers">
      <h2>Story blockers</h2>
      {blockers.length === 0 ? (
        <p>No outstanding story decisions.</p>
      ) : (
        blockers.map((d) => (
          <article key={d.id}>
            <h3>{context.storyDrafts.find((s) => s.id === d.itemId)?.title}</h3>
            <p>{d.question}</p>
            <p>Owner · Product manager</p>
            <p>
              Age ·{" "}
              {Math.max(
                0,
                Math.floor((Date.now() - Date.parse(d.createdAt)) / 60000),
              )}{" "}
              min
            </p>
            <p>Next action · {d.missing || "Review the proposed answer"}</p>
            <DecisionReview decision={d} productId={context.productId} />
          </article>
        ))
      )}
    </section>
  );
}
