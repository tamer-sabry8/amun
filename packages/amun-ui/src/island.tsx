import { useState } from "react";
import type { AttentionItem } from "@amun/contracts";
import type { IslandSize } from "./layout.ts";
import { Icon } from "./icons.tsx";
export const attentionLabels: Record<AttentionItem["type"], string> = {
  unblock: "Unblock",
  answer: "Answer",
  decide: "Decision",
  approve: "Approval",
  review: "Review",
  apply: "Apply",
  create: "Create",
  go_to: "Next step",
  reconnect: "Reconnect",
  resolve_conflict: "Resolve conflict",
};
interface Props {
  items: AttentionItem[];
  size: IslandSize;
  products?: { id: string; name: string }[];
  onSize(size: IslandSize): void;
  onNavigate(item: AttentionItem): void;
  onAnswer(item: AttentionItem, answer: string): void;
  onSnooze(item: AttentionItem): void;
}
function Item({
  item,
  onNavigate,
  onAnswer,
  onSnooze,
  expanded = false,
}: Pick<Props, "onNavigate" | "onAnswer" | "onSnooze"> & {
  item: AttentionItem;
  expanded?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [answer, setAnswer] = useState("");
  const inline =
    item.type === "answer" &&
    !item.governed &&
    item.primaryAction.mode === "inline";
  return (
    <article className={"island-item type-" + item.type} data-item-id={item.id}>
      <div className="island-origin">
        {item.origin.label}
        <span className="type-label">{attentionLabels[item.type]}</span>
      </div>
      <p className="island-ask">{item.ask}</p>
      {editing && inline ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (answer.trim()) onAnswer(item, answer);
          }}
        >
          <label>
            Answer
            <textarea
              autoFocus
              value={answer}
              maxLength={16384}
              onChange={(event) => setAnswer(event.target.value)}
            />
          </label>
          <button className="primary" type="submit" disabled={!answer.trim()}>
            Save answer
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          className="primary island-primary"
          onClick={() => (inline ? setEditing(true) : onNavigate(item))}
        >
          {item.primaryAction.label}
        </button>
      )}
      {expanded && (
        <details className="item-menu">
          <summary aria-label={"More actions for " + item.ask}>More</summary>
          <button onClick={() => onSnooze(item)}>Snooze for one hour</button>
        </details>
      )}
    </article>
  );
}
export function Island(props: Props) {
  const { items, size, onSize, onNavigate } = props;
  const first = items[0];
  if (size === "rail")
    return (
      <section
        className={
          "firstmate-island island-rail type-" + (first?.type ?? "empty")
        }
        aria-label="Firstmate requests"
        aria-live="polite"
      >
        {first ? (
          <button
            title={`Firstmate · ${items.length} need you`}
            aria-label={`Firstmate · ${items.length} need you`}
            onClick={() => onNavigate(first)}
          >
            <span className="firstmate-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M10 3h5l7 18h-5l-1-4H8l-2 4H1L10 3zm0 10h4l-1-6-3 6z"
                />
              </svg>
            </span>
            <span className="count">{items.length}</span>
          </button>
        ) : (
          <span
            title="Nothing needs you right now"
            aria-label="Nothing needs you right now"
            className="firstmate-mark"
          >
            A
          </span>
        )}
      </section>
    );
  return (
    <section
      className={"firstmate-island island-" + size}
      aria-label="Firstmate requests"
      aria-live="polite"
      data-testid="island"
      data-count={items.length}
    >
      <div className="island-heading">
        <span className="firstmate-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M10 3h5l7 18h-5l-1-4H8l-2 4H1L10 3zm0 10h4l-1-6-3 6z"
            />
          </svg>
        </span>
        <div>
          <strong>Firstmate</strong>
          <span>{first ? `${items.length} need you` : "All clear"}</span>
        </div>
        {first && (
          <button
            className="icon-button"
            aria-label={
              size === "pill" ? "Expand Firstmate" : "Collapse Firstmate"
            }
            onClick={() => onSize(size === "pill" ? "card" : "pill")}
          >
            <Icon name="chevron" />
          </button>
        )}
      </div>
      {!first ? (
        <p className="muted island-empty">Nothing needs you right now</p>
      ) : size === "pill" ? (
        <button className="pill-action" onClick={() => onNavigate(first)}>
          {first.ask}
          <span className="count">{items.length}</span>
        </button>
      ) : size === "expanded" ? (
        <>
          <div className="expanded-queue">
            {(props.products ?? [{ id: first.productId, name: "Workspace" }])
              .filter((product) =>
                items.some((item) => item.productId === product.id),
              )
              .map((product) => (
                <div key={product.id}>
                  <h3 className="queue-product">{product.name}</h3>
                  {items
                    .filter((item) => item.productId === product.id)
                    .map((item) => (
                      <Item
                        key={item.id}
                        item={item}
                        expanded
                        onNavigate={props.onNavigate}
                        onAnswer={props.onAnswer}
                        onSnooze={props.onSnooze}
                      />
                    ))}
                </div>
              ))}
          </div>
          <button className="text-button" onClick={() => onSize("card")}>
            Show top request
          </button>
        </>
      ) : (
        <>
          <Item
            item={first}
            onNavigate={props.onNavigate}
            onAnswer={props.onAnswer}
            onSnooze={props.onSnooze}
          />
          {items.length > 1 && (
            <button
              className="text-button more-requests"
              onClick={() => onSize("expanded")}
            >
              +{items.length - 1} more
            </button>
          )}
        </>
      )}
    </section>
  );
}
