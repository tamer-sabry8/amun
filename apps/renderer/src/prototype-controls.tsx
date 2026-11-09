import { useRef, useState, useEffect } from "react";
import { prototypeResult } from "@amun/contracts";
import { bridge } from "./bridge.ts";
export function PrototypeControls({
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
    <section aria-label="Prototype">
      <button disabled={busy} onClick={() => send("start")}>
        Explore a prototype
      </button>
      <button disabled={busy} onClick={() => send("preview")}>
        Open Designer preview
      </button>
      <button disabled={busy} onClick={() => send("feedback")}>
        Review pinned feedback
      </button>
      <p role="status">{busy ? "Checking Designer run…" : status}</p>
    </section>
  );
}
