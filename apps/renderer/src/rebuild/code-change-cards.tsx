import { useEffect, useRef, useState } from "react";
import { codeChangeResult, type CodeChangeCard } from "@amun/contracts";
import { bridge } from "../bridge.ts";

const sign = (n: number, mark: string) => (n ? `${mark}${n}` : "");

/**
 * Code changes an agent made in Amun's own copy of a repository. The owner
 * reads the exact change here; only an approval opens a pull request.
 */
export function CodeChangeCards({
  product,
  onOpened,
}: {
  product: string;
  onOpened: () => void;
}) {
  const [cards, setCards] = useState<CodeChangeCard[]>([]),
    [status, notify] = useState(""),
    [busy, wait] = useState(false),
    [asking, ask] = useState<string | null>(null);
  const pending = useRef("");
  const opened = useRef(new Set<string>());
  const seeded = useRef(false);

  const send = (args: Record<string, unknown>) => {
    const id = crypto.randomUUID();
    pending.current = id;
    wait(true);
    bridge.send({ version: 1, kind: "code-change", id, product, ...args });
  };

  useEffect(
    () =>
      bridge.onEvent((raw) => {
        const parsed = codeChangeResult.safeParse(raw);
        if (!parsed.success) return;
        const v = parsed.data;
        if (v.product !== product || v.id !== pending.current) return;
        wait(false);
        notify(v.message);
        setCards(v.cards);
        // Pull requests that were already open are not announced again.
        let announce = false;
        for (const card of v.cards)
          if (card.state === "open" && !opened.current.has(card.id)) {
            opened.current.add(card.id);
            announce = seeded.current;
          }
        seeded.current = true;
        if (announce) onOpened();
      }),
    [product, onOpened],
  );
  useEffect(() => {
    send({ action: "list" });
    // Once per project.
  }, [product]);
  const shown = [
    ...cards.filter((c) => !["declined", "open"].includes(c.state)),
    ...cards.filter((c) => c.state === "open").slice(0, 3),
  ];
  if (!shown.length)
    return status ? (
      <p className="muted small" role="status" aria-live="polite">
        {status}
      </p>
    ) : null;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <h3 style={{ margin: 0 }}>Code changes</h3>
      <p className="muted small" role="status" aria-live="polite">
        {busy ? "Checking…" : status}
      </p>
      {shown.map((card) => {
        const name = `${card.repo.owner}/${card.repo.name}`;
        const waiting = card.state === "waiting" || card.state === "approved";
        return (
          <section
            key={card.id}
            className={"rb-inline" + (waiting ? " amber" : "")}
            aria-label={`Code change for ${name}`}
          >
            <strong>Code change for {name}</strong>
            <span className="muted small">
              New branch {card.branch} from {card.base}
            </span>
            <details>
              <summary>Message ({card.message.split("\n")[0]})</summary>
              <p style={{ whiteSpace: "pre-wrap", margin: "6px 0 0" }}>
                {card.message}
              </p>
            </details>
            <div style={{ display: "grid", gap: 4 }}>
              <strong>Files ({card.files.length})</strong>
              <ul aria-label="Changed files" style={{ margin: 0 }}>
                {card.files.map((file) => (
                  <li key={file.path}>
                    {file.path}{" "}
                    <span className="muted small">
                      {file.status === "added"
                        ? "new"
                        : file.status === "removed"
                          ? "deleted"
                          : file.status === "renamed"
                            ? "renamed"
                            : "changed"}{" "}
                      {sign(file.additions, "+")} {sign(file.deletions, "−")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <pre
              tabIndex={0}
              aria-label="The exact change"
              style={{
                margin: 0,
                maxHeight: 320,
                overflow: "auto",
                whiteSpace: "pre",
                fontSize: 12.5,
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            >
              {card.diff}
            </pre>
            <span className="note">
              Opens a pull request. Nothing is merged.
            </span>
            {card.blocker && waiting && (
              <span className="note" role="alert">
                {card.blocker}
              </span>
            )}
            {card.state === "open" && card.pull && (
              <span role="status">
                Pull request #{card.pull.number} is open: {card.pull.url}
              </span>
            )}
            {card.state === "opening" && (
              <span role="status">Opening the pull request…</span>
            )}
            {card.state === "unconfirmed" && (
              <>
                <span className="note" role="status">
                  I couldn’t confirm that GitHub received it. Nothing is sent
                  twice.
                </span>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    send({
                      action: "approve",
                      reviewId: card.id,
                      binding: card.binding,
                    })
                  }
                >
                  Check again
                </button>
              </>
            )}
            {card.state === "failed" && (
              <span className="note" role="status">
                {card.blocker ??
                  "Nothing was sent. Ask Firstmate to try again."}
              </span>
            )}
            {card.state === "waiting" &&
              (asking === card.id ? (
                <form
                  style={{ display: "grid", gap: 8 }}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const note = new FormData(event.currentTarget).get("note");
                    ask(null);
                    send({
                      action: "changes",
                      reviewId: card.id,
                      note: String(note ?? ""),
                    });
                  }}
                >
                  <label className="field">
                    <span>What should be different?</span>
                    <textarea name="note" required maxLength={4000} autoFocus />
                  </label>
                  <span className="row">
                    <button className="btn" disabled={busy}>
                      Send to Firstmate
                    </button>
                    <button
                      type="button"
                      className="btn quiet"
                      onClick={() => ask(null)}
                    >
                      Cancel
                    </button>
                  </span>
                </form>
              ) : (
                <span className="row wrap">
                  <button
                    className="btn"
                    disabled={busy || !!card.blocker}
                    onClick={() =>
                      send({
                        action: "approve",
                        reviewId: card.id,
                        binding: card.binding,
                      })
                    }
                  >
                    Approve and open pull request
                  </button>
                  <button
                    className="btn quiet"
                    disabled={busy}
                    onClick={() => ask(card.id)}
                  >
                    Request changes
                  </button>
                </span>
              ))}
          </section>
        );
      })}
    </div>
  );
}
