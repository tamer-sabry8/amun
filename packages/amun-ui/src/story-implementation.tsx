import { useEffect, useState, useRef } from "react";
import { deliveryResult, type WorkspaceSnapshot } from "@amun/contracts";
import { bridge } from "./bridge.ts";
export function StoryImplementation({
  context,
  story,
}: {
  context: NonNullable<WorkspaceSnapshot["productContext"]>;
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
      <button
        onClick={() => {
          setOpen(true);
          send("status");
        }}
      >
        Ask Firstmate to implement
      </button>
    );
  return (
    <section aria-label="Implementation scope">
      <label>
        Implementation repository
        <select value={source} onChange={(e) => select(e.target.value)}>
          <option value="">Select repository</option>
          {context.sources
            .filter((s) => s.kind === "repo")
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
        </select>
      </label>
      <label>
        Branch purpose
        <select value={prefix} onChange={(e) => setPrefix(e.target.value)}>
          <option value="delivery">Delivery</option>
          <option value="test">Test</option>
        </select>
      </label>
      <label>
        Local repository checkout
        <input value={checkout} onChange={(e) => setCheckout(e.target.value)} />
      </label>
      <button
        disabled={busy || !source || !checkout}
        onClick={() => send("prepare", { source, checkout, prefix })}
      >
        Preview implementation scope
      </button>
      {reply?.run && (
        <div>
          <p>
            {reply.run.scope.remote} · {reply.run.scope.head}
          </p>
          <p>Writable branch {reply.run.scope.branch}</p>
          <p>Worktree {reply.run.scope.worktree}</p>
          {reply.run.state === "succeeded" && (
            <button
              disabled={busy}
              onClick={() =>
                send("refresh", {
                  run: reply.run!.scope.id,
                  binding: reply.run!.binding,
                })
              }
            >
              Check worker report and resume
            </button>
          )}
          {["pending_approval", "unknown"].includes(reply.run.state) && (
            <button
              disabled={busy}
              onClick={() =>
                send("start", {
                  run: reply.run!.scope.id,
                  binding: reply.run!.binding,
                })
              }
            >
              {reply.run.state === "unknown"
                ? "Retry same delivery"
                : "Approve scope and start run"}
            </button>
          )}
        </div>
      )}
      <p role="status">
        {busy ? "Loading implementation scope…" : reply?.message}
      </p>
    </section>
  );
}
