import { SprintGoal } from "./sprint-goal.tsx";
import {
  ProjectFilter,
  useProjectFilter,
  matchesProjectTag,
} from "./project-backlog-filter.tsx";
import { PlanningFields } from "./planning-fields.tsx";
import {
  placeBefore,
  reviewedRank,
  successor,
} from "../../../domain/src/work/backlog-order.ts";
import { PlannedStoryRow } from "./planned-story-row.tsx";
import { plannedStory, type PlannedStory } from "@amun/contracts";
import { readPlanningCache, savePlanningCache } from "./planning-cache.ts";
import { plannedLoad, teamBudgetKey } from "./sprint-load.ts";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
  planningChangeCount,
  recordPlanningReceipt,
  normalizePlanningDraft,
  scopedDraftKey,
  stageMove,
  type PlanningDraft,
  type PlanningScope,
  type PlannedMove,
} from "./planning-draft.ts";

type Card = Extract<BacklogResult, { view: "cards" }>["cards"][number];

export function SprintPlanner({
  scope,
  name,
  members,
  destinations = [],
  refreshMembers,
  offlineOnly = false,
  openBlockers,
  focus,
  openChat,
}: {
  scope: PlanningScope;
  name: string;
  members: { id: string; title: string }[];
  destinations?: { id: string; name: string; path: string }[];
  refreshMembers?(): void;
  offlineOnly?: boolean;
  openBlockers?: Record<string, number>;
  focus?: { ref: string; storyId: number } | undefined;
  openChat(chatId: string, requestRef?: string): void;
}) {
  const connected = useSyncExternalStore(
    bridge.subscribe,
    () => bridge.getSnapshot().status === "Connected",
  );
  const projectFilter = useProjectFilter(scope);
  const activeTag = projectFilter.full ? "" : projectFilter.tag;
  const [carryTo, setCarryTo] = useState("");
  const [carryIds, setCarryIds] = useState<number[]>([]);
  const [budget, setBudget] = useState(() => {
    try {
      return browserStore()?.getItem(teamBudgetKey(scope)) ?? "";
    } catch {
      return "";
    }
  });
  const [newFocus, setNewFocus] = useState("");
  const [creationTarget, setCreationTarget] = useState<NonNullable<
    Extract<BacklogResult, { view: "cards" }>["creationTarget"]
  > | null>(null);
  const [fieldOptions, setFieldOptions] = useState<
    Pick<
      Extract<BacklogResult, { view: "cards" }>,
      "identities" | "transitions"
    >
  >({});
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
  const [cached] = useState(() => readPlanningCache(scope));
  const [cards, setCards] = useState<Card[] | null>(
    cached?.result.cards ?? null,
  );
  const [checkedAt, setCheckedAt] = useState(cached?.at ?? "");
  const [fresh, setFresh] = useState(false);
  const [backlogPath, setBacklogPath] = useState<string | null>(
    cached?.result.backlogIteration ?? null,
  );
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
  >(() =>
    Object.fromEntries(
      (draft?.submissions ?? []).map((b) => [b.ref, b.result?.receipts ?? []]),
    ),
  );
  const [receiptText, setReceiptText] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (draft?.submissions ?? []).map((b) => [b.ref, b.result?.message ?? ""]),
    ),
  );
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
        try {
          const next = recordPlanningReceipt(
            browserStore(),
            scope,
            ref,
            result,
          );
          if (next) setDraft(next);
        } catch {
          setError(
            "Couldn’t save the receipt on this device. Check the original request after reopening.",
          );
        }
        setReceiptText((prev) => ({ ...prev, [ref]: result.message }));
        if (result.receipts) {
          setReceipts((prev) => ({ ...prev, [ref]: result.receipts! }));
          if (result.receipts.some((r) => r.state === "confirmed")) {
            refresh((n) => n + 1);
            refreshMembers?.();
          }
        }
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
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, [key]);
  useEffect(() => {
    const requestId = crypto.randomUUID();
    setFresh(false);
    if (offlineOnly || !connected) return;
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
        const at = new Date().toISOString();
        setFresh(true);
        setCheckedAt(at);
        savePlanningCache(scope, {
          at,
          name,
          iteration: scope.iteration,
          members,
          result: parsed.data,
        });
        setCards(parsed.data.cards);
        setCreationTarget(parsed.data.creationTarget ?? null);
        setFieldOptions({
          identities: parsed.data.identities,
          transitions: parsed.data.transitions,
        });
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
  }, [key, attempt, detailsQuery, offlineOnly, connected]);
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
      const normalized = normalizePlanningDraft(next);
      store.setItem(key, JSON.stringify(normalized));
      setDraft(normalized);
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
              (r) =>
                r.itemId === String(move.id) &&
                (r.state === "confirmed" ||
                  r.state === "held" ||
                  r.state === "kept"),
            ),
        )
        .map((move) => move.id),
    ),
  );
  const ready = draft.moves.filter(
    (m) =>
      !submittedIds.has(m.id) &&
      (!m.reorder ||
        (!submittedIds.has(m.reorder.beforeId) &&
          !!cards &&
          !!reviewedRank(cards, m.id, m.reorder))) &&
      cards?.some(
        (c) =>
          c.id === m.id &&
          c.iteration === m.from &&
          (!m.criteria || c.criteria === m.criteria.from) &&
          (c.rev === m.rev ||
            (m.criteria &&
              m.to === m.from &&
              !m.status &&
              !m.owner &&
              !m.reorder &&
              !m.addLabels?.length)),
      ),
  );
  const creates = draft.creates ?? [];
  const updateCreated = (story: PlannedStory) =>
    save({
      ...draft,
      creates: creates.map((s) => (s.localId === story.localId ? story : s)),
    });
  const normalize = (s: string) =>
    s
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const candidates = (title: string) => {
    const t = normalize(title);
    return t
      ? (cards ?? []).filter((c) => {
          const known = normalize(c.title);
          return (
            t === known ||
            (known.length > 5 &&
              t.length > 5 &&
              (known.includes(t) || t.includes(known)))
          );
        })
      : [];
  };
  const readyCreates =
    creationTarget && cards
      ? creates.flatMap((s) => {
          const parsed = plannedStory.safeParse({
            ...s,
            criteria: s.criteria.map((x) => x.trim()).filter(Boolean),
            labels: [...new Set(s.labels.map((x) => x.trim()).filter(Boolean))],
          });
          return parsed.success && (!candidates(s.title).length || s.separate)
            ? [parsed.data]
            : [];
        })
      : [];
  const readyCount = planningChangeCount(ready) + readyCreates.length,
    totalCount = planningChangeCount(draft.moves) + creates.length;
  const apply = async () => {
    if (applying.current || !readyCount || !fresh || offlineOnly) return;
    if (bridge.getSnapshot().status !== "Connected") {
      setError(
        "Waiting for Firstmate. Refresh the backlog and apply when connected.",
      );
      return;
    }
    if (!cards || !readyCount) {
      setError("Refresh the changed records before applying this draft.");
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
      if (!mounted.current) return;
      if (!chat.ok || !chat.ref) {
        setError(chat.message);
        return;
      }
      if (bridge.getSnapshot().status !== "Connected") {
        setError("Waiting for Firstmate. Apply when connected.");
        return;
      }
      const latest = loadDraft(browserStore(), scope);
      const unchanged =
        ready.every((m) =>
          latest.moves.some(
            (entry) =>
              entry.id === m.id && JSON.stringify(entry) === JSON.stringify(m),
          ),
        ) &&
        readyCreates.every(
          (s) =>
            JSON.stringify(
              latest.creates?.find((c) => c.localId === s.localId),
            ) === JSON.stringify(creates.find((c) => c.localId === s.localId)),
        );
      if (!unchanged || latest.id !== draft.id) {
        setDraft(latest);
        setError(
          "The draft changed while preparing this request. Review it before applying.",
        );
        return;
      }
      const batch = {
        ref: newRequestRef(),
        chatId: chat.ref,
        moves: ready,
        ...(readyCreates.length ? { creates: readyCreates } : {}),
      };
      if (
        !save({
          ...latest,
          moves: latest.moves.filter((m) => !ready.some((r) => r.id === m.id)),
          creates: (latest.creates ?? []).filter(
            (s) => !readyCreates.some((r) => r.localId === s.localId),
          ),
          submissions: [...(latest.submissions ?? []), batch],
        })
      )
        return;
      const requestId = crypto.randomUUID();
      inspections.current.set(requestId, batch.ref);
      setReceiptText((prev) => ({
        ...prev,
        [batch.ref]: "Pending Firstmate confirmation",
      }));
      bridge.send({
        version: 1,
        kind: "ado-operation",
        action: "apply-sprint-moves",
        requestId,
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
        ...(readyCreates.length
          ? { creates: readyCreates, creationTarget }
          : {}),
      });
    } catch {
      setError(
        "Couldn’t verify the saved draft. Reopen the planner to check its receipt.",
      );
    } finally {
      applying.current = false;
      setPreparing(false);
    }
  };
  const add = (
    card: Card,
    suggestedOwner?: NonNullable<PlannedMove["owner"]>,
  ) => {
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
        ...(suggestedOwner ? { owner: suggestedOwner } : {}),
      }),
    );
  };
  const fields = (card: Card | undefined) =>
    card && (
      <PlanningFields
        card={card}
        pending={draft.moves.find((m) => m.id === card.id)}
        options={fieldOptions}
        disabled={preparing || submittedIds.has(card.id)}
        stage={(m) => !applying.current && save(stageMove(draft, m))}
      />
    );
  const search = query.trim().toLocaleLowerCase();
  const ordered = draft.moves.reduce(
    (list, m) =>
      m.reorder ? placeBefore(list, m.id, m.reorder.beforeId) : list,
    cards ?? [],
  );
  const reorder = (id: number, beforeId: number) => {
    const card = cards?.find((c) => c.id === id),
      anchor = cards?.find((c) => c.id === beforeId);
    if (
      !cards ||
      !card?.iteration ||
      !anchor ||
      id === beforeId ||
      applying.current
    )
      return;
    const previous = draft.moves.find((m) => m.id === id);
    const oldNext = successor(cards, id) ?? null;
    const intent = { beforeId, anchorRev: anchor.rev, oldNext };
    if (beforeId !== oldNext && !reviewedRank(cards, id, intent)) {
      setError("The shared backlog order cannot be verified.");
      return;
    }
    save(
      stageMove(draft, {
        id,
        rev: card.rev,
        title: card.title,
        from: card.iteration,
        to: previous?.to ?? card.iteration,
        reorder: beforeId === oldNext ? undefined : intent,
      }),
    );
  };
  const filtered =
    cards &&
    ordered.filter(
      (card) =>
        matchesProjectTag(card.labels, activeTag) &&
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
  const additionsOnly =
    readyCount > 0 &&
    !readyCreates.length &&
    ready.every(
      (m) =>
        m.to === scope.iteration &&
        m.from !== m.to &&
        !m.addLabels?.length &&
        !m.reorder &&
        !m.criteria &&
        !m.status &&
        !m.owner,
    );
  const load = cards
    ? plannedLoad(members, cards, draft.moves, scope.iteration)
    : null;
  const projectIds = new Set(
    cards
      ?.filter((c) => matchesProjectTag(c.labels, projectFilter.tag))
      .map((c) => String(c.id)),
  );
  const projectLoad =
    projectFilter.tag && cards
      ? plannedLoad(
          members.filter((m) => projectIds.has(m.id)),
          cards,
          draft.moves.filter((m) => projectIds.has(String(m.id))),
          scope.iteration,
        )
      : null;
  const budgetValue =
    budget.trim() !== "" &&
    Number.isFinite(Number(budget)) &&
    Number(budget) >= 0
      ? Number(budget)
      : null;
  return (
    <section aria-label="Sprint planning">
      {(!connected || offlineOnly) && (
        <p role="status">
          Waiting for Firstmate · changes stay on this device.
        </p>
      )}
      {checkedAt && (
        <p className="muted small">
          {fresh && !offlineOnly
            ? "Backlog checked"
            : "Saved backlog · last checked"}{" "}
          {new Date(checkedAt).toLocaleString()}
        </p>
      )}
      <div className="rb-planning-panes">
        <section aria-label="Team backlog">
          <h2>Team backlog</h2>
          {cards && (
            <ProjectFilter
              filter={projectFilter}
              labels={cards.flatMap((c) => c.labels ?? [])}
              matching={
                cards.filter((c) =>
                  matchesProjectTag(c.labels, projectFilter.tag),
                ).length
              }
              total={cards.length}
              noun="backlog"
            />
          )}
          <button
            className="btn"
            disabled={preparing}
            onClick={() => {
              const localId = crypto.randomUUID();
              if (
                save({
                  ...draft,
                  creates: [
                    ...creates,
                    {
                      localId,
                      title: "",
                      criteria: [],
                      labels: activeTag ? [activeTag] : [],
                      schedule: false,
                    },
                  ],
                })
              )
                setNewFocus(localId);
            }}
          >
            + Story
          </button>
          {creates.map((story) => (
            <PlannedStoryRow
              key={story.localId}
              story={story}
              matches={candidates(story.title).map((c) => ({
                ...c,
                outside:
                  activeTag && !matchesProjectTag(c.labels, activeTag)
                    ? activeTag
                    : "",
              }))}
              name={name}
              focus={newFocus === story.localId}
              people={fieldOptions.identities ?? []}
              useExisting={(id, rev, labels, schedule, ownerId, wording) => {
                const card = cards?.find((c) => c.id === id);
                if (
                  !fresh ||
                  !card?.iteration ||
                  card.rev !== rev ||
                  submittedIds.has(id) ||
                  applying.current ||
                  draft.moves.some((m) => m.id === id)
                ) {
                  setError(
                    "Refresh the existing story and review any staged changes before using it.",
                  );
                  return;
                }
                const addLabels = labels.filter(
                  (label) =>
                    !card.labels?.some(
                      (l) => l.toLowerCase() === label.toLowerCase(),
                    ),
                );
                const person = fieldOptions.identities?.find(
                  (p) => p.id === ownerId,
                );
                if (
                  (ownerId &&
                    (!person || (card.assignee && !card.assigneeId))) ||
                  (wording !== null && !card.readableCriteria)
                ) {
                  setError("The reviewed fields changed. Refresh this story.");
                  return;
                }
                const next = stageMove(draft, {
                  id,
                  rev: card.rev,
                  title: card.title,
                  from: card.iteration,
                  to: schedule ? scope.iteration : card.iteration,
                  ...(person
                    ? { owner: { from: card.assigneeId ?? null, to: person } }
                    : {}),
                  ...(wording !== null
                    ? { criteria: { from: card.criteria ?? "", text: wording } }
                    : {}),
                  ...(addLabels.length ? { addLabels } : {}),
                });
                save({
                  ...next,
                  creates: creates.filter((c) => c.localId !== story.localId),
                });
                setError(
                  "Using existing story #" +
                    id +
                    ". Review staged changes before applying.",
                );
              }}
              update={updateCreated}
              remove={() =>
                save({
                  ...draft,
                  creates: creates.filter((s) => s.localId !== story.localId),
                })
              }
            />
          ))}
          {!!creates.length && (
            <p className="muted small">
              {creationTarget
                ? "Create " + creationTarget.type + " in " + creationTarget.area
                : "Creation awaits a verified team backlog, area and work item type."}
            </p>
          )}

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
              onDragOver={(e) => {
                if (card.rank) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                reorder(
                  Number(e.dataTransfer.getData("text/amun-work-item")),
                  card.id,
                );
              }}
              draggable={!!card.iteration}
              onDragStart={(e) =>
                e.dataTransfer.setData("text/amun-work-item", String(card.id))
              }
            >
              <div className="grow">
                <details
                  aria-label={"Backlog story " + card.id}
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
                {fields(card)}
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
              {card.rank && filtered && filtered.indexOf(card) > 0 && (
                <button
                  className="btn quiet"
                  disabled={preparing}
                  aria-label={"Move " + card.title + " up in the backlog"}
                  onClick={() =>
                    reorder(card.id, filtered[filtered.indexOf(card) - 1]!.id)
                  }
                >
                  Move up
                </button>
              )}
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
            const localId = e.dataTransfer.getData("text/amun-draft-story");
            const local = creates.find((s) => s.localId === localId);
            if (local) {
              updateCreated({ ...local, schedule: true });
              return;
            }
            const id = Number(e.dataTransfer.getData("text/amun-work-item"));
            const card = filtered?.find((row) => row.id === id);
            if (card) add(card);
          }}
        >
          <h2>{name}</h2>
          <SprintGoal
            key={JSON.stringify([scopedDraftKey(scope), activeTag])}
            planningLoad={
              load
                ? {
                    teamPoints: load.points,
                    unestimated:
                      load.unknown.length +
                      creates.filter((c) => c.schedule).length,
                    localBudget: budgetValue,
                  }
                : undefined
            }
            scope={scope}
            name={name}
            tag={activeTag}
            cards={cards ?? []}
            people={fieldOptions.identities ?? []}
            enabled={fresh && connected && !offlineOnly && !preparing}
            stage={(card, owner) => add(card, owner)}
            unavailable={(id) =>
              submittedIds.has(id) ||
              draft.moves.some((m) => m.id === id) ||
              members.some((m) => m.id === String(id))
            }
          />
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
                <div className="grow">
                  {story.title}
                  {fields(cards?.find((c) => String(c.id) === story.id))}
                </div>
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
          {creates
            .filter((s) => s.schedule)
            .map((s) => (
              <p key={s.localId}>
                {s.title || "Untitled story"} · staged for {name}
              </p>
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
                  {move.status
                    ? " · Status: " + move.status.from + " → " + move.status.to
                    : ""}
                  {move.criteria ? " · Acceptance criteria edited" : ""}
                  {move.owner ? " · Owner: " + move.owner.to.name : ""}
                  {move.reorder ? " · Before #" + move.reorder.beforeId : ""}
                  {move.addLabels?.length
                    ? " · Add labels: " + move.addLabels.join(", ")
                    : ""}
                </small>
              </span>
              {fields(cards?.find((c) => c.id === move.id))}
              {move.status &&
                /^(done|closed|completed)$/i.test(move.status.to) &&
                openBlockers?.[String(move.id)] && (
                  <span className="tag warn">
                    {openBlockers[String(move.id)]} open blocker
                  </span>
                )}
              {cards
                ?.find((c) => c.id === move.id)
                ?.prerequisites?.map((id) => {
                  const before = cards.find((c) => c.id === id);
                  if (
                    !before ||
                    before.id === move.id ||
                    before.iteration === scope.iteration ||
                    draft.moves.some(
                      (m) => m.id === id && m.to === scope.iteration,
                    )
                  )
                    return null;
                  return (
                    <button
                      key={id}
                      className="btn quiet"
                      disabled={
                        !before.iteration || preparing || submittedIds.has(id)
                      }
                      onClick={() => add(before)}
                      aria-label={"Add prerequisite " + before.title}
                    >
                      Add {before.title}
                    </button>
                  );
                })}
              {!!move.addLabels?.length && move.from !== move.to && (
                <>
                  <button
                    className="btn quiet"
                    disabled={preparing}
                    onClick={() =>
                      save(stageMove(draft, { ...move, addLabels: undefined }))
                    }
                  >
                    Undo labels
                  </button>
                  <button
                    className="btn quiet"
                    disabled={preparing}
                    onClick={() =>
                      save(
                        stageMove(draft, {
                          ...move,
                          to: move.from,
                          targetSprintId: undefined,
                        }),
                      )
                    }
                  >
                    Undo move
                  </button>
                </>
              )}
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
              {batch.moves
                .filter((move) =>
                  receipts[batch.ref]?.some(
                    (r) => r.itemId === String(move.id) && r.state === "held",
                  ),
                )
                .map((move) => {
                  const current = cards?.find((c) => c.id === move.id);
                  const canStage =
                    current?.iteration &&
                    !draft.moves.some((m) => m.id === move.id) &&
                    !submittedIds.has(move.id);
                  return (
                    <div
                      className="rb-line"
                      key={move.id}
                      tabIndex={-1}
                      ref={(node) => {
                        if (
                          node &&
                          focus?.ref === batch.ref &&
                          focus.storyId === move.id &&
                          !node.dataset.focused
                        ) {
                          node.dataset.focused = "true";
                          node.focus();
                        }
                      }}
                    >
                      <span className="grow">
                        #{move.id} {move.title}
                        <small>
                          Proposed {move.to} · reviewed from {move.from} ·
                          currently {current?.iteration ?? "unavailable"}
                        </small>
                      </span>
                      {current?.iteration && (
                        <button
                          className="btn quiet"
                          disabled={!fresh || preparing}
                          onClick={() => {
                            const requestId = crypto.randomUUID();
                            inspections.current.set(requestId, batch.ref);
                            bridge.send({
                              version: 1,
                              kind: "ado-operation",
                              action: "keep-observed-sprint",
                              requestId,
                              ref: batch.ref,
                              workAreaId: scope.areaId,
                              productId: scope.productId,
                              sourceId: scope.sourceId,
                              team: scope.team,
                              sprintId: scope.sprintId,
                              itemId: move.id,
                              rev: current.rev,
                              iteration: current.iteration,
                            });
                          }}
                        >
                          Keep in {current.iteration}
                        </button>
                      )}
                      <button
                        className="btn quiet"
                        disabled={preparing || !canStage}
                        onClick={() => {
                          if (!current?.iteration || applying.current) return;
                          const target =
                            move.from === move.to ? current.iteration : move.to;
                          if (
                            target === current.iteration &&
                            !move.addLabels?.length
                          ) {
                            setError(
                              "This story is already in the requested sprint.",
                            );
                            return;
                          }
                          if (
                            move.targetSprintId &&
                            current.iteration !== scope.iteration
                          ) {
                            setError(
                              "Review the new source sprint before carrying this story forward.",
                            );
                            return;
                          }
                          save(
                            stageMove(draft, {
                              ...move,
                              title: current.title,
                              rev: current.rev,
                              from: current.iteration,
                              to: target,
                            }),
                          );
                        }}
                      >
                        Review again
                      </button>
                    </div>
                  );
                })}
              {batch.creates?.map((story) => {
                const receipt = receipts[batch.ref]?.find(
                  (r) => r.itemId === story.localId,
                );
                if (receipt?.state !== "held") return null;
                const card = cards?.find((c) => c.id === receipt.remoteId);
                if (receipt.remoteId !== null)
                  return (
                    <div className="rb-line" key={story.localId}>
                      <span>
                        #{receipt.remoteId} {story.title}
                      </span>
                      {story.schedule &&
                        card?.iteration &&
                        card.iteration !== scope.iteration && (
                          <button
                            className="btn"
                            disabled={
                              preparing ||
                              draft.moves.some((m) => m.id === card.id)
                            }
                            onClick={() => add(card)}
                          >
                            Stage assignment
                          </button>
                        )}
                    </div>
                  );
                return (
                  <button
                    key={story.localId}
                    className="btn quiet"
                    disabled={
                      preparing ||
                      creates.some((s) => s.localId === story.localId)
                    }
                    onClick={() =>
                      save({
                        ...draft,
                        creates: [...creates, { ...story, separate: false }],
                      })
                    }
                  >
                    Review {story.title}
                  </button>
                );
              })}
              {receiptText[batch.ref] && (
                <p role="status" style={{ whiteSpace: "pre-line" }}>
                  {receiptText[batch.ref]}
                </p>
              )}
            </section>
          ))}
          {load && (
            <section aria-label="Team planning capacity">
              {projectLoad && (
                <p>
                  {projectFilter.tag} · {projectLoad.points} planned points
                  {projectLoad.unknown.length
                    ? " · " + projectLoad.unknown.length + " unestimated"
                    : ""}
                </p>
              )}
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
          {fresh && totalCount > readyCount && (
            <p role="status">
              {totalCount - readyCount} waiting for updated records
            </p>
          )}
          {totalCount > 0 && (
            <button
              className="btn primary"
              disabled={
                preparing || !readyCount || !fresh || offlineOnly || !connected
              }
              onClick={() => void apply()}
            >
              {!ready.length &&
              readyCreates.length === 1 &&
              readyCreates[0]?.schedule
                ? "Create story and add to " + name
                : additionsOnly
                  ? "Add " +
                    readyCount +
                    " " +
                    (readyCount === 1 ? "story" : "stories") +
                    " to " +
                    name
                  : "Apply " +
                    readyCount +
                    " " +
                    (readyCount === 1 ? "change" : "changes")}
            </button>
          )}
          {totalCount > 0 && (
            <p role="status">
              {totalCount} {totalCount === 1 ? "change" : "changes"} saved on
              this device
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
