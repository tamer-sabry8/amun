import { useEffect, useRef, useState } from "react";
import type { WorkspaceSnapshot } from "@amun/contracts";
import { updateResult } from "../../../packages/contracts/src/stakeholder.ts";
import { bridge } from "./bridge.ts";
export function StakeholderEditor({
  context,
}: {
  context: WorkspaceSnapshot["productContext"];
}) {
  const [title, setTitle] = useState("Stakeholder update"),
    [text, setText] = useState(""),
    [objective, scope] = useState(""),
    [message, notify] = useState(""),
    [channel, setChannel] = useState("pdf"),
    [editing, setEditing] = useState(false),
    [exact, setExact] = useState({ title: "", text: "" }),
    [busy, setBusy] = useState(false);
  const [review, setReview] =
    useState<ReturnType<typeof updateResult.parse>["review"]>();
  const request = useRef("");
  useEffect(
    () =>
      bridge.onEvent((raw) => {
        if ((raw as { kind?: string } | null)?.kind === "service-lost") {
          setReview(undefined);
          setBusy(false);
          return;
        }
        const event = updateResult.safeParse(raw);
        if (
          !event.success ||
          event.data.productId !== (context?.productId ?? null) ||
          request.current !== event.data.request
        )
          return;
        const r = event.data;
        setBusy(false);
        setReview(r.review);
        notify(r.message ?? "");
        if (r.title !== undefined && r.text !== undefined) {
          if (r.review) setExact({ title: r.title, text: r.text });
          else {
            setEditing(true);
            setTitle(r.title);
            setText(r.text);
          }
        }
      }),
    [context?.productId ?? null],
  );
  const send = (action: string, fields: Record<string, unknown>) => {
    request.current = crypto.randomUUID();
    setBusy(true);
    notify("");
    bridge.send({
      version: 1,
      kind: "stakeholder",
      productId: context?.productId ?? null,
      request: request.current,
      action,
      ...fields,
    });
  };
  return (
    <details>
      <summary>Stakeholder update</summary>
      <fieldset disabled={busy}>
        <label>
          Update scope
          <select
            value={objective}
            onChange={(e) => {
              scope(e.target.value);
              setReview(undefined);
              setText("");
            }}
          >
            <option value="">{context ? "Product" : "Portfolio"}</option>
            {context?.objectives.map((o) => (
              <option key={o.id} value={o.id}>
                {o.statement}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => send("draft", objective ? { objective } : {})}>
          Draft from source records
        </button>
        {editing ? (
          <>
            <label>
              Update title
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setReview(undefined);
                }}
              />
            </label>
            <label>
              Update content
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setReview(undefined);
                }}
              />
            </label>
            <label>
              Share via
              <select
                value={channel}
                onChange={(e) => {
                  setChannel(e.target.value);
                  setReview(undefined);
                }}
              >
                <option value="pdf">PDF export</option>
                <option value="notion">Notion</option>
              </select>
            </label>
            {review ? (
              <>
                <h4>{exact.title}</h4>
                <pre>{exact.text}</pre>
                <p>{review.destination}</p>
                <button
                  onClick={() =>
                    send("approve", {
                      id: review.id,
                      binding: review.binding,
                      ...exact,
                      channel,
                    })
                  }
                >
                  Approve exact{" "}
                  {channel === "pdf" ? "PDF export" : "Notion publication"}
                </button>
              </>
            ) : (
              <button
                disabled={!text.trim() || !title.trim()}
                onClick={() => send("review", { title, text, channel })}
              >
                Review exact content and destination
              </button>
            )}
          </>
        ) : null}
      </fieldset>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
