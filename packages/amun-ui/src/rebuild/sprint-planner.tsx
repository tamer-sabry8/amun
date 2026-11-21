import { plannedLoad, teamBudgetKey } from "./sprint-load.ts";
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
  destinations = [],
  openChat,
}: {
  scope: PlanningScope;
  name: string;
  members: { id: string; title: string }[];
  destinations?: { id: string; name: string; path: string }[];
  openChat(chatId: string, requestRef?: string): void;
}) {
  const [carryTo, setCarryTo] = useState("");
  const [carryIds, setCarryIds] = useState<number[]>([]);
  const [budget, setBudget] = useState(() => {
    try {
      return browserStore()?.getItem(teamBudgetKey(scope)) ?? "";
    } catch {
      return "";
    }
  });
  const [editingLabel, setEditingLabel] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(() => {
    try {
      return loadDraft(browserStore(), scope);
    } catch {
      return null;
    }
  });
  const [cards, setCards] = useState<Card[] | null>(null);
  const [backlogPath, setBacklogPath] = useState<string | null>(null);
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
    setBacklogPath(null);
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
        setBacklogPath(parsed.data.backlogIteration ?? null);
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
      details: true,
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
      !draft.moves.some((s) => s.id === card.id && s.to !== s.from) &&
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
  const additionsOnly = draft.moves.every(
    (m) => m.to === scope.iteration && m.from !== m.to && !m.addLabels?.length,
  );
  const load = cards
    ? plannedLoad(members, cards, draft.moves, scope.iteration)
    : null;
  const budgetValue =
    budget.trim() !== "" &&
    Number.isFinite(Number(budget)) &&
    Number(budget) >= 0
      ? Number(budget)
      : null;
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
              <div className="grow">
                <details
                  onToggle={(event) => {
                    if (event.currentTarget.open)
                      inspectView({
                        view: "Backlog story details",
                        areaId: scope.areaId,
                        record: String(card.id),
                        source: scope.sourceId,
                      });
                  }}
                >
                  <summary>
                    <strong>
                      #{card.id} {card.title}
                    </strong>
                    <small>
                      {[
                        card.state,
                        ...(card.estimates?.length
                          ? card.estimates.map((e) => e.name + " " + e.value)
                          : ["Estimate unavailable"]),
                        card.iteration ?? "Iteration unavailable",
                        ...(card.blocked ? ["Blocked: " + card.blocked] : []),
                      ].join(" · ")}
                    </small>
                  </summary>
                  <p>
                    {card.criteria?.replace(/<[^>]+>/g, " ").trim() ||
                      "No acceptance criteria available."}
                  </p>
                  <p className="muted small">
                    Owner · {card.assignee || "Unassigned or unavailable"}
                  </p>
                  <p className="muted small">
                    Labels · {card.labels?.join(", ") || "None recorded"}
                  </p>
                  <p className="muted small">
                    Azure · {scope.team} · #{card.id} · revision {card.rev}
                  </p>
                </details>
              </div>
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
              {card.labels && card.iteration && (
                <button
                  className="btn quiet"
                  disabled={preparing || submittedIds.has(card.id)}
                  onClick={() => {
                    setLabel("");
                    setEditingLabel(editingLabel === card.id ? null : card.id);
                  }}
                >
                  Label
                </button>
              )}
              {editingLabel === card.id && (
                <form
                  className="row wrap"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const value = label.trim();
                    if (
                      !value ||
                      /[;\r\n]/.test(value) ||
                      value.length > 128 ||
                      !card.iteration ||
                      applying.current
                    )
                      return;
                    const prior = draft.moves.find((m) => m.id === card.id);
                    if (
                      [
                        ...(card.labels ?? []),
                        ...(prior?.addLabels ?? []),
                      ].some((l) => l.toLowerCase() === value.toLowerCase())
                    ) {
                      setError(
                        "This label is already on the story or in your draft.",
                      );
                      return;
                    }
                    if (
                      save(
                        stageMove(draft, {
                          id: card.id,
                          rev: card.rev,
                          title: card.title,
                          from: card.iteration,
                          to: prior?.to ?? card.iteration,
                          addLabels: [...(prior?.addLabels ?? []), value],
                        }),
                      )
                    )
                      setEditingLabel(null);
                  }}
                >
                  <input
                    aria-label={"Label for " + card.title}
                    value={label}
                    maxLength={128}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                  <button className="btn" disabled={!label.trim()}>
                    Stage label
                  </button>
                </form>
              )}
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
          {destinations.some((s) => s.id !== scope.sprintId) &&
            members.length > 0 && (
              <details>
                <summary
                  onClick={() =>
                    inspectView({
                      view: "Carry stories forward",
                      source: scope.sourceId,
                      areaId: scope.areaId,
                      record: scope.sprintId,
                    })
                  }
                >
                  Carry stories forward
                </summary>
                <label className="field">
                  Destination sprint
                  <select
                    value={carryTo}
                    onChange={(e) => setCarryTo(e.target.value)}
                  >
                    <option value="">Choose a sprint</option>
                    {destinations
                      .filter((s) => s.id !== scope.sprintId)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.path}
                        </option>
                      ))}
                  </select>
                </label>
                {cards
                  ?.filter(
                    (c) =>
                      members.some((s) => s.id === String(c.id)) &&
                      c.iteration === scope.iteration &&
                      !draft.moves.some((m) => m.id === c.id) &&
                      !submittedIds.has(c.id),
                  )
                  .map((c) => (
                    <label className="rb-line" key={c.id}>
                      <input
                        type="checkbox"
                        checked={carryIds.includes(c.id)}
                        onChange={(e) =>
                          setCarryIds((prev) =>
                            e.target.checked
                              ? [...prev, c.id]
                              : prev.filter((id) => id !== c.id),
                          )
                        }
                      />
                      <span>
                        #{c.id} {c.title} · {c.state}
                      </span>
                    </label>
                  ))}
                <button
                  className="btn"
                  disabled={preparing || !carryTo || !carryIds.length}
                  onClick={() => {
                    const target = destinations.find(
                      (s) => s.id === carryTo && s.id !== scope.sprintId,
                    );
                    if (!target || !cards || applying.current) return;
                    let next = draft;
                    for (const c of cards)
                      if (
                        carryIds.includes(c.id) &&
                        members.some((s) => s.id === String(c.id)) &&
                        c.iteration === scope.iteration &&
                        !submittedIds.has(c.id) &&
                        !draft.moves.some((m) => m.id === c.id)
                      )
                        next = stageMove(next, {
                          id: c.id,
                          rev: c.rev,
                          title: c.title,
                          from: scope.iteration,
                          to: target.path,
                          targetSprintId: target.id,
                        });
                    if (save(next)) setCarryIds([]);
                  }}
                >
                  Stage selected moves
                </button>
              </details>
            )}
          {members
            .filter(
              (story) => !draft.moves.some((m) => String(m.id) === story.id),
            )
            .map((story) => (
              <div className="rb-line" key={story.id}>
                <span className="grow">{story.title}</span>
                {backlogPath &&
                  backlogPath !== scope.iteration &&
                  cards?.some(
                    (c) =>
                      String(c.id) === story.id &&
                      c.iteration === scope.iteration,
                  ) && (
                    <button
                      className="btn quiet"
                      disabled={preparing || submittedIds.has(Number(story.id))}
                      onClick={() => {
                        const card = cards.find(
                          (c) => String(c.id) === story.id,
                        );
                        if (card && !applying.current)
                          save(
                            stageMove(draft, {
                              id: card.id,
                              rev: card.rev,
                              title: card.title,
                              from: scope.iteration,
                              to: backlogPath,
                            }),
                          );
                      }}
                    >
                      Return to backlog
                    </button>
                  )}
              </div>
            ))}
          {draft.moves.map((move) => (
            <div className="rb-line" key={move.id}>
              <span className="grow">
                <strong>
                  #{move.id} {move.title}
                </strong>
                <small>
                  {move.from !== move.to
                    ? move.from + " → " + move.to
                    : move.from}
                  {move.addLabels?.length
                    ? " · Add labels: " + move.addLabels.join(", ")
                    : ""}
                </small>
              </span>
              <button
                className="btn quiet"
                onClick={() =>
                  !applying.current &&
                  save({
                    ...draft,
                    moves: draft.moves.filter((m) => m.id !== move.id),
                  })
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
                    openChat(batch.chatId, batch.ref);
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
          {load && (
            <section aria-label="Team planning capacity">
              <p>
                Team · {load.points} planned points
                {budgetValue !== null ? " of " + budgetValue : ""}
              </p>
              {budgetValue !== null && load.points > budgetValue && (
                <p className="tag warn">
                  {load.points - budgetValue} points over budget
                </p>
              )}
              {!!load.unknown.length && (
                <details>
                  <summary>
                    {load.unknown.length} without a point estimate
                  </summary>
                  <ul>
                    {load.unknown.map((title, index) => (
                      <li key={index}>{title}</li>
                    ))}
                  </ul>
                </details>
              )}
              <label className="field">
                Planning budget · kept in Amun
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={budget}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (
                      value &&
                      (!Number.isFinite(Number(value)) || Number(value) < 0)
                    )
                      return;
                    try {
                      const storage = browserStore();
                      if (!storage) throw Error();
                      if (value) storage.setItem(teamBudgetKey(scope), value);
                      else storage.removeItem(teamBudgetKey(scope));
                      setBudget(value);
                    } catch {
                      setError(
                        "Could not save the planning budget on this device.",
                      );
                    }
                  }}
                />
              </label>
            </section>
          )}
          {draft.moves.length > 0 && (
            <button
              className="btn primary"
              disabled={preparing || !cards}
              onClick={() => void apply()}
            >
              {additionsOnly
                ? "Add " +
                  draft.moves.length +
                  " " +
                  (draft.moves.length === 1 ? "story" : "stories") +
                  " to " +
                  name
                : "Apply " +
                  draft.moves.length +
                  " " +
                  (draft.moves.length === 1 ? "change" : "changes")}
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
