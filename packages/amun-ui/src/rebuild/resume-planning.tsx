import { useState } from "react";
import { browserStore } from "../backlog-selection.ts";
import { inspectView } from "../daemon/navigation.ts";
import {
  savedPlanningLinks,
  loadDraft,
  scopedDraftKey,
  stageMove,
  type SavedPlanningLink,
} from "./planning-draft.ts";
export function ResumePlanning({
  areas,
  open,
}: {
  areas: ReadonlySet<string>;
  open(link: SavedPlanningLink): void;
}) {
  return (
    <>
      {savedPlanningLinks(browserStore(), areas).map((link) => (
        <button
          className="btn quiet"
          key={link.id}
          onClick={() => {
            inspectView({
              view: "Resume planning draft",
              areaId: link.areaId,
              source: link.sourceId,
              record: link.id,
            });
            open(link);
          }}
        >
          Resume draft · {link.count} {link.count === 1 ? "change" : "changes"}
        </button>
      ))}
    </>
  );
}

export function OfflinePlanning({ link }: { link: SavedPlanningLink }) {
  const [, refresh] = useState(0);
  const [error, setError] = useState("");
  const store = browserStore();
  if (!store)
    return (
      <p role="alert">Saved planning changes are unavailable on this device.</p>
    );
  try {
    const draft = loadDraft(store, link);
    if (draft.id !== link.id)
      return <p role="status">This draft is no longer available.</p>;
    return (
      <section aria-label="Saved sprint draft">
        <h2>Saved changes</h2>
        <p className="muted">
          {link.team} · {link.backlog}
        </p>
        <p>
          Reconnect this backlog and sprint to verify the changes before
          applying them.
        </p>
        {draft.moves.map((move) => (
          <div className="rb-line" key={move.id}>
            <span className="grow">
              <strong>
                #{move.id} {move.title}
              </strong>
              <small>
                {move.from} → {move.to}
              </small>
            </span>
            <button
              className="btn quiet"
              onClick={() => {
                try {
                  const latest = loadDraft(store, link);
                  if (latest.id !== link.id) throw Error();
                  const current = latest.moves.find(
                    (m) =>
                      m.id === move.id &&
                      m.to === move.to &&
                      m.from === move.from,
                  );
                  if (current)
                    store.setItem(
                      scopedDraftKey(link),
                      JSON.stringify(
                        stageMove(latest, { ...current, to: current.from }),
                      ),
                    );
                  refresh((v) => v + 1);
                } catch {
                  setError("Could not update this saved draft.");
                }
              }}
            >
              Undo
            </button>
          </div>
        ))}
        {!draft.moves.length && <p>No changes left to apply.</p>}
        {error && <p role="alert">{error}</p>}
      </section>
    );
  } catch {
    return <p role="alert">The saved draft could not be read.</p>;
  }
}
