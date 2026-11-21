import { useEffect, useState } from "react";
import { backlogResult, type BacklogResult } from "@amun/contracts";
import { bridge } from "../bridge.ts";
import { browserStore } from "../backlog-selection.ts";
import { inspectView } from "../daemon/navigation.ts";
import {
  loadDraft,
  scopedDraftKey,
  stageMove,
  type PlanningDraft,
  type PlanningScope,
} from "./planning-draft.ts";

type Card = Extract<BacklogResult, { view: "cards" }>["cards"][number];

export function SprintPlanner({
  scope,
  name,
  members,
}: {
  scope: PlanningScope;
  name: string;
  members: { id: string; title: string }[];
}) {
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(() => {
    try {
      return loadDraft(browserStore(), scope);
    } catch {
      return null;
    }
  });
  const [cards, setCards] = useState<Card[] | null>(null);
  const [query, setQuery] = useState("");
  const [attempt, refresh] = useState(0);
  const key = scopedDraftKey(scope);
  useEffect(() => {
    const requestId = crypto.randomUUID();
    setCards(null);
    setError("");
    const timer = setTimeout(
      () => setError("The backlog did not answer. Refresh to try again."),
      20000,
    );
    const stop = bridge.onEvent((event) => {
      const parsed = backlogResult.safeParse(event);
      if (
        !parsed.success ||
        parsed.data.requestId !== requestId ||
        parsed.data.productId !== scope.productId
      )
        return;
      clearTimeout(timer);
      if (parsed.data.view === "cards") {
        setCards(parsed.data.cards);
        setError("");
      }
      if (parsed.data.view === "error") setError(parsed.data.message);
    });
    bridge.send({
      version: 1,
      kind: "backlog-read",
      action: "cards",
      requestId,
      productId: scope.productId,
      sourceId: scope.sourceId,
      team: scope.team,
      level: scope.backlog,
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [key, attempt]);
  if (!draft)
    return (
      <p role="alert">
        The saved planning draft could not be read. Your saved changes are still
        on this device.
      </p>
    );
  const save = (next: PlanningDraft) => {
    try {
      const store = browserStore();
      if (!store) throw Error();
      store.setItem(key, JSON.stringify(next));
      setDraft(next);
    } catch {
      setError("Amun could not save this change on your device.");
    }
  };
  const add = (card: Card) => {
    if (
      !card.iteration ||
      !draft ||
      members.some((story) => story.id === String(card.id))
    )
      return;
    save(
      stageMove(draft, {
        id: card.id,
        rev: card.rev,
        title: card.title,
        from: card.iteration,
        to: scope.iteration,
      }),
    );
  };
  const search = query.trim().toLocaleLowerCase();
  const filtered = cards?.filter(
    (card) =>
      !members.some((s) => s.id === String(card.id)) &&
      !draft.moves.some((s) => s.id === card.id) &&
      (card.title.toLocaleLowerCase().includes(search) ||
        String(card.id).includes(search.replace(/^#/, ""))),
  );
  return (
    <section aria-label="Sprint planning">
      <div className="rb-planning-panes">
        <section aria-label="Team backlog">
          <h2>Team backlog</h2>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              inspectView({
                view: "Search team backlog for " + query,
                areaId: scope.areaId,
                record: scope.backlog,
                source: "Sprint planning · ID and title",
              });
            }}
          >
            <input
              className="field grow"
              type="search"
              aria-label="Search backlog by ID or title"
              placeholder="Story ID or title"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="btn" type="submit">
              Search
            </button>
          </form>
          {!cards && !error && <p role="status">Loading backlog…</p>}
          {filtered?.length === 0 && (
            <p className="muted">No matching stories.</p>
          )}
          {filtered?.map((card) => (
            <div
              className="rb-line"
              key={card.id}
              draggable={!!card.iteration}
              onDragStart={(e) =>
                e.dataTransfer.setData("text/amun-work-item", String(card.id))
              }
            >
              <span className="grow">
                <strong>
                  #{card.id} {card.title}
                </strong>
                <small>{card.iteration ?? "Iteration unavailable"}</small>
              </span>
              <button
                className="btn"
                disabled={!card.iteration}
                aria-label={"Add " + card.title + " to " + name}
                onClick={() => add(card)}
              >
                + Sprint
              </button>
            </div>
          ))}
        </section>
        <section
          aria-label={name}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const id = Number(e.dataTransfer.getData("text/amun-work-item"));
            const card = filtered?.find((row) => row.id === id);
            if (card) add(card);
          }}
        >
          <h2>{name}</h2>
          <p className="muted small">{scope.iteration}</p>
          {members.map((story) => (
            <div className="rb-line" key={story.id}>
              {story.title}
            </div>
          ))}
          {draft.moves.map((move) => (
            <div className="rb-line" key={move.id}>
              <span className="grow">
                <strong>
                  #{move.id} {move.title}
                </strong>
                <small>Staged from {move.from}</small>
              </span>
              <button
                className="btn quiet"
                onClick={() =>
                  save(stageMove(draft, { ...move, to: move.from }))
                }
              >
                Undo
              </button>
            </div>
          ))}
          {!members.length && !draft.moves.length && (
            <p className="muted">Add a backlog story to plan this sprint.</p>
          )}
          {draft.moves.length > 0 && (
            <p role="status">
              {draft.moves.length}{" "}
              {draft.moves.length === 1 ? "change" : "changes"} saved on this
              device
            </p>
          )}
        </section>
      </div>
      {error && (
        <p role="alert">
          {error}{" "}
          <button className="btn quiet" onClick={() => refresh((n) => n + 1)}>
            Refresh backlog
          </button>
        </p>
      )}
    </section>
  );
}
