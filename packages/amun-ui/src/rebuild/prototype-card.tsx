import { useEffect, useRef, useState } from "react";
import { prototypeResult } from "@amun/contracts";
import { bridge } from "../bridge.ts";

/** Once the PRD is approved: explore a prototype, open its preview, read feedback. */
export function PrototypeCard({
  product,
  objective,
  revision,
  open,
  review,
}: {
  product: string;
  objective: string;
  revision: number;
  open: (url: string) => void;
  review: () => void;
}) {
  const last = useRef(""),
    [status, show] = useState(""),
    [busy, wait] = useState(false);
  useEffect(
    () =>
      bridge.onEvent((raw) => {
        const r = prototypeResult.safeParse(raw);
        if (
          !r.success ||
          r.data.product !== product ||
          r.data.objective !== objective ||
          r.data.id !== last.current
        )
          return;
        wait(false);
        show(r.data.message);
        if (r.data.url) open(r.data.url);
        if (r.data.proposal) review();
      }),
    [product, objective, open, review],
  );
  const send = (action: string) => {
    last.current = crypto.randomUUID();
    wait(true);
    bridge.send({
      version: 1,
      kind: "prototype",
      product,
      objective,
      revision,
      id: last.current,
      action,
    });
  };
  return (
    <section className="rb-inline" aria-label="Prototype">
      <h3>Prototype</h3>
      <div className="row wrap">
        <button className="btn" disabled={busy} onClick={() => send("start")}>
          Explore a prototype
        </button>
        <button className="btn" disabled={busy} onClick={() => send("preview")}>
          Open the preview
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() => send("feedback")}
        >
          Read the feedback
        </button>
      </div>
      <p className="note" role="status">
        {busy ? "Checking on the prototype…" : status}
      </p>
    </section>
  );
}
