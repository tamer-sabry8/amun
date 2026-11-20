// Moving a chat that has unfinished requests (owner's chat handoff, approved
// 20 November 2026). Filing the chat and changing a request's project are
// separate: the second needs Firstmate to agree, so the owner picks exactly
// which requests to reassign. None are ticked to begin with.
import { useEffect, useRef, useState } from "react";

export interface UnfinishedRequest {
  ref: string;
  /** The owner's words. */
  text: string;
  /** Where it stands, in plain words. */
  line: string;
}

export function MoveDialog({
  chatTitle,
  from,
  to,
  /** False when the destination is General: there is no project to move to. */
  canReassign,
  requests,
  onCancel,
  onMove,
}: {
  chatTitle: string;
  from: string;
  to: string;
  canReassign: boolean;
  requests: UnfinishedRequest[];
  onCancel(): void;
  onMove(reassign: string[]): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<"chat" | "both">("chat");
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);
  const count = requests.length;
  return (
    <dialog
      ref={dialog}
      className="rb-move-dialog"
      aria-labelledby="rb-move-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="rb-move-title">
        Move “{chatTitle}” to {to}
      </h2>
      <p className="dir">
        <span className="rb-chip">{from}</span>
        <span aria-hidden="true">→</span>
        <span className="rb-chip">{to}</span>
        <span className="muted">
          · {count} {count === 1 ? "request" : "requests"} not finished
        </span>
      </p>
      <fieldset>
        <legend className="sr-only">What to move</legend>
        <label className={"opt" + (mode === "chat" ? " on" : "")}>
          <input
            type="radio"
            name="move"
            checked={mode === "chat"}
            onChange={() => setMode("chat")}
          />
          <span>
            Move chat only
            <small>
              {count === 1 ? "The request stays" : "The requests stay"} with{" "}
              {from}.
            </small>
          </span>
        </label>
        {canReassign && (
          <label className={"opt" + (mode === "both" ? " on" : "")}>
            <input
              type="radio"
              name="move"
              checked={mode === "both"}
              onChange={() => setMode("both")}
            />
            <span>
              Move chat and ask Firstmate to change the project
              <small>Choose which requests should become {to}'s.</small>
            </span>
          </label>
        )}
      </fieldset>
      {mode === "both" && (
        <ul className="reqs" aria-label="Requests to move">
          {requests.map((request) => (
            <li key={request.ref}>
              <label>
                <input
                  type="checkbox"
                  checked={picked.includes(request.ref)}
                  onChange={(event) =>
                    setPicked(
                      event.target.checked
                        ? [...picked, request.ref]
                        : picked.filter((item) => item !== request.ref),
                    )
                  }
                />
                <span>
                  {request.text.length > 90
                    ? request.text.slice(0, 87) + "…"
                    : request.text}
                  <small>{request.line || "Sent to Firstmate"}</small>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="acts">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn solid"
          disabled={mode === "both" && picked.length === 0}
          onClick={() => onMove(mode === "both" ? picked : [])}
        >
          {mode === "both" ? "Move and ask Firstmate" : "Move chat"}
        </button>
      </div>
    </dialog>
  );
}
