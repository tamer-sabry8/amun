import { useEffect, useRef, useState } from "react";
import {
  deliveryResult,
  type StoryDecision,
  type WorkspaceSnapshot,
} from "@amun/contracts";
import { bridge } from "../bridge.ts";
import { stack } from "./view-parts.tsx";

type Context = NonNullable<WorkspaceSnapshot["productContext"]>;

/** Asks Firstmate to implement a story: preview the setup, approve, start. */
export function StoryImplementation({
  context,
  story,
}: {
  context: Context;
  story: string;
}) {
  const [open, setOpen] = useState(false),
    [source, select] = useState(""),
    [prefix, setPrefix] = useState("delivery"),
    [checkout, setCheckout] = useState(""),
    [reply, setReply] = useState<ReturnType<typeof deliveryResult.parse>>(),
    [busy, wait] = useState(false);
  const last = useRef(""),
    product = context.productId;
  const send = (action: string, fields: Record<string, string> = {}) => {
    last.current = crypto.randomUUID();
    wait(true);
    bridge.send({
      version: 1,
      kind: "crew-delivery",
      id: last.current,
      action,
      product,
      story,
      ...fields,
    });
  };
  useEffect(
    () =>
      bridge.onEvent((value) => {
        const r = deliveryResult.safeParse(value);
        if (
          r.success &&
          r.data.product === product &&
          r.data.story === story &&
          r.data.id === last.current
        ) {
          wait(false);
          setReply(r.data);
        } else if (
          value &&
          typeof value === "object" &&
          "kind" in value &&
          value.kind === "service-lost"
        ) {
          wait(false);
          setReply(undefined);
          setOpen(false);
        }
      }),
    [product, story],
  );
  if (!open)
    return (
      <div className="row">
        <button
          className="btn"
          onClick={() => {
            setOpen(true);
            send("status");
          }}
        >
          Ask Firstmate to implement
        </button>
      </div>
    );
  return (
    <section style={stack} aria-label="Implementation scope">
      <label className="field">
        Repository to work in
        <select value={source} onChange={(e) => select(e.target.value)}>
          <option value="">Choose a repository</option>
          {context.sources
            .filter((s) => s.kind === "repo")
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
        </select>
      </label>
      <label className="field">
        What the work is for
        <select value={prefix} onChange={(e) => setPrefix(e.target.value)}>
          <option value="delivery">Delivery</option>
          <option value="test">Test</option>
        </select>
      </label>
      <label className="field">
        Folder of the repository on this Mac
        <input
          type="text"
          value={checkout}
          onChange={(e) => setCheckout(e.target.value)}
        />
      </label>
      <div className="row">
        <button
          className="btn"
          disabled={busy || !source || !checkout}
          onClick={() => send("prepare", { source, checkout, prefix })}
        >
          Preview the setup
        </button>
      </div>
      {reply?.run && (
        <div style={stack}>
          <p className="muted small">
            {reply.run.scope.remote} · {reply.run.scope.head}
          </p>
          <p>Firstmate will work on the branch {reply.run.scope.branch}</p>
          <p>In this folder: {reply.run.scope.worktree}</p>
          <div className="row wrap">
            {reply.run.state === "succeeded" && (
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  send("refresh", {
                    run: reply.run!.scope.id,
                    binding: reply.run!.binding,
                  })
                }
              >
                Check the crew’s report and continue
              </button>
            )}
            {["pending_approval", "unknown"].includes(reply.run.state) && (
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  send("start", {
                    run: reply.run!.scope.id,
                    binding: reply.run!.binding,
                  })
                }
              >
                {reply.run.state === "unknown"
                  ? "Try the same delivery again"
                  : "Approve and start"}
              </button>
            )}
          </div>
        </div>
      )}
      <p className="muted small" role="status">
        {busy ? "Getting the setup ready…" : reply?.message}
      </p>
    </section>
  );
}

/** One question Firstmate raised about a story, with its answer options. */
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
    <section className="rb-inline amber" aria-label="Story decision">
      <h3>{d.question}</h3>
      <p>
        <span className="muted small">
          Firstmate suggests (not approved yet):{" "}
        </span>
        {d.proposed}
      </p>
      {d.state === "resolved" ? (
        <p className="row wrap">
          <span className="tag good">Resolved</span>
          {d.choice}
        </p>
      ) : (
        <>
          <label className="field">
            Decision option
            <select value={choice} onChange={(e) => setChoice(e.target.value)}>
              {d.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <p className="muted small">
            {d.requested ? "Confirmation requested" : "Not confirmed yet"} ·
            Still missing: {d.missing || "nothing"}
          </p>
          <label className="field">
            How it was confirmed
            <input
              type="text"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <div className="row wrap">
            <button className="btn" onClick={() => send("save")}>
              Save proposed answer
            </button>
            <button className="btn" onClick={() => send("request")}>
              Request confirmation
            </button>
            <button className="btn quiet" onClick={() => send("later")}>
              Later
            </button>
            <button
              className="btn"
              disabled={!!d.missing && !confirmation.trim()}
              onClick={() => send("resolve")}
            >
              Resolve decision
            </button>
          </div>
        </>
      )}
    </section>
  );
}
