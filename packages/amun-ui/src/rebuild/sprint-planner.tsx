import { useEffect, useRef, useState } from "react";
import {
  backlogResult,
  operationResult,
  type BacklogResult,
} from "@amun/contracts";
import { bridge } from "../bridge.ts";
import { browserStore } from "../backlog-selection.ts";
import { workAsync } from "./store.ts";
import { newRequestRef } from "../../../domain/src/work/requests.ts";
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
  openChat,
}: {
  scope: PlanningScope;
  name: string;
  members: { id: string; title: string }[];
  openChat(chatId: string): void;
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
  const [detailsQuery, setDetailsQuery] = useState<string | null>(null);
  const searchBacklog = (details: boolean) => {
    inspectView({
      view: "Search backlog",
      areaId: scope.areaId,
      record: scope.backlog,
      source: scope.sourceId,
      search: { query, details, backlog: scope.backlog },
    });
    setDetailsQuery(details ? query : null);
    if (details) refresh((n) => n + 1);
  };
  const [attempt, refresh] = useState(0);
  const [receipts, setReceipts] = useState<
    Record<
      string,
      NonNullable<ReturnType<typeof operationResult.parse>["receipts"]>
    >
  >({});
  const [receiptText, setReceiptText] = useState<Record<string, string>>({});
  const inspections = useRef(new Map<string, string>());
  useEffect(
    () =>
      bridge.onEvent((event) => {
        const parsed = operationResult.safeParse(event);
        if (!parsed.success || parsed.data.productId !== scope.productId)
          return;
        const result = parsed.data;
        const ref = inspections.current.get(result.requestId);
        if (!ref) return;
        inspections.current.delete(result.requestId);
        if (result.requestRef && result.requestRef !== ref) return;
        setReceiptText((prev) => ({ ...prev, [ref]: result.message }));
        if (result.receipts)
          setReceipts((prev) => ({ ...prev, [ref]: result.receipts! }));
      }),
    [scope.productId],
  );
  const inspectSubmission = (ref: string) => {
    const requestId = crypto.randomUUID();
    inspections.current.set(requestId, ref);
    inspectView({
      view: "Sprint receipt",
      areaId: scope.areaId,
      record: ref,
      source: "Sprint planning",
    });
    bridge.send({
      version: 1,
      kind: "ado-operation",
      action: "inspect-sprint-submission",
      requestId,
      ref,
      workAreaId: scope.areaId,
      productId: scope.productId,
      sourceId: scope.sourceId,
      team: scope.team,
      sprintId: scope.sprintId,
    });
  };
  const applying = useRef(false);
  const [preparing, setPreparing] = useState(false);
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
      details: detailsQuery !== null,
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [key, attempt, detailsQuery]);
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
      return true;
    } catch {
      setError("Amun could not save this change on your device.");
      return false;
    }
  };
  const submitted = draft.submissions ?? [];
  const submittedIds = new Set(
    submitted.flatMap((batch) =>
      batch.moves
        .filter(
          (move) =>
            !receipts[batch.ref]?.some(
              (r) => r.itemId === String(move.id) && r.state === "confirmed",
            ),
        )
        .map((move) => move.id),
    ),
  );
  const apply = async () => {
    if (applying.current || !draft.moves.length) return;
    if (bridge.getSnapshot().status !== "Connected") {
      setError(
        "Waiting for Firstmate. Refresh the backlog and apply when connected.",
      );
      return;
    }
    if (
      !cards ||
      draft.moves.some(
        (m) =>
          !cards.some(
            (c) => c.id === m.id && c.rev === m.rev && c.iteration === m.from,
          ),
      )
    ) {
      setError(
        "A staged story changed. Refresh the backlog and review its move.",
      );
      return;
    }
    applying.current = true;
    setPreparing(true);
    try {
      const chat = await workAsync("new-chat", {
        told: true,
        workAreaId: scope.areaId,
        sprint: {
          connection: scope.sourceId,
          id: "ado:" + scope.sprintId,
          name,
        },
      });
      if (!chat.ok || !chat.ref) {
        setError(chat.message);
        return;
      }
      if (bridge.getSnapshot().status !== "Connected") {
        setError("Waiting for Firstmate. Apply when connected.");
        return;
      }
      const batch = {
        ref: newRequestRef(),
        chatId: chat.ref,
        moves: draft.moves,
      };
      if (!save({ ...draft, moves: [], submissions: [...submitted, batch] }))
        return;
      bridge.send({
        version: 1,
        kind: "ado-operation",
        action: "apply-sprint-moves",
        requestId: crypto.randomUUID(),
        ref: batch.ref,
        workAreaId: scope.areaId,
        chatId: chat.ref,
        productId: scope.productId,
        sourceId: scope.sourceId,
        team: scope.team,
        level: scope.backlog,
        sprintId: scope.sprintId,
        iteration: scope.iteration,
        moves: batch.moves,
      });
      openChat(chat.ref);
    } finally {
      applying.current = false;
      setPreparing(false);
    }
  };
  const add = (card: Card) => {
    if (applying.current || submittedIds.has(card.id)) return;
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
        (detailsQuery !== null &&
          [card.description, card.criteria].some((text) =>
            text
              ?.replace(/<[^>]*>/g, " ")
              .toLocaleLowerCase()
              .includes(search),
          )) ||
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
              searchBacklog(false);
            }}
          >
            <input
              className="field grow"
              type="search"
              aria-label="Search backlog by ID or title"
              placeholder="Story ID or title"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setDetailsQuery(null);
              }}
            />
            <button className="btn" type="submit">
              Search
            </button>
          </form>
          {query.trim() && (
            <button className="btn quiet" onClick={() => searchBacklog(true)}>
              Search story details
            </button>
          )}
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
                disabled={
                  preparing || !card.iteration || submittedIds.has(card.id)
                }
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
                  !applying.current &&
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
          {submitted.map((batch) => (
            <section key={batch.ref} aria-label={"Submission " + batch.ref}>
              <div className="row wrap">
                <button
                  className="btn quiet"
                  onClick={() => {
                    inspectView({
                      view: "Original sprint request",
                      areaId: scope.areaId,
                      record: batch.ref,
                    });
                    openChat(batch.chatId);
                  }}
                >
                  View request · {batch.ref}
                </button>
                <button
                  className="btn quiet"
                  onClick={() => inspectSubmission(batch.ref)}
                >
                  Check receipt
                </button>
              </div>
              {receiptText[batch.ref] && (
                <p role="status" style={{ whiteSpace: "pre-line" }}>
                  {receiptText[batch.ref]}
                </p>
              )}
            </section>
          ))}
          {draft.moves.length > 0 && (
            <button
              className="btn primary"
              disabled={preparing || !cards}
              onClick={() => void apply()}
            >
              Apply {draft.moves.length}{" "}
              {draft.moves.length === 1 ? "change" : "changes"}
            </button>
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
