import { useEffect, useRef, useState } from "react";
import { operationResult, type BacklogResult } from "@amun/contracts";
import { newRequestRef } from "../../../domain/src/work/requests.ts";
import { bridge } from "../bridge.ts";
import { browserStore } from "../backlog-selection.ts";
import { workAsync } from "./store.ts";
import {
  scopedDraftKey,
  type PlanningScope,
  type PlannedMove,
} from "./planning-draft.ts";
type Read = Extract<BacklogResult, { view: "cards" }>;
type Suggestions = NonNullable<
  ReturnType<typeof operationResult.parse>["suggestions"]
>;
export function SprintGoal({
  scope,
  name,
  tag,
  cards,
  people,
  enabled,
  stage,
  unavailable,
}: {
  scope: PlanningScope;
  name: string;
  tag: string;
  cards: Read["cards"];
  people: NonNullable<Read["identities"]>;
  enabled: boolean;
  stage(
    card: Read["cards"][number],
    owner?: NonNullable<PlannedMove["owner"]>,
  ): void;
  unavailable(id: number): boolean;
}) {
  const key = "amun.sprint-goal.v1:" + scopedDraftKey(scope);
  const [goal, setGoal] = useState(() => {
    try {
      return browserStore()?.getItem(key) ?? "";
    } catch {
      return "";
    }
  });
  const [suggestions, setSuggestions] = useState<Suggestions>([]),
    [owners, setOwners] = useState<number[]>([]),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef<{ id: string; ref: string } | null>(null);
  useEffect(() => {
    const stop = bridge.onEvent((event) => {
      const result = operationResult.safeParse(event),
        asked = pending.current;
      if (
        !asked ||
        !result.success ||
        result.data.productId !== scope.productId ||
        result.data.requestId !== asked.id ||
        (result.data.requestRef && result.data.requestRef !== asked.ref)
      )
        return;
      pending.current = null;
      setBusy(false);
      setNotice(result.data.message);
      setOwners([]);
      setSuggestions(result.data.suggestions ?? []);
    });
    return () => {
      stop();
      pending.current = null;
    };
  }, [key]);
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => {
      pending.current = null;
      setBusy(false);
      setNotice(
        "Check the original sprint chat for Firstmate’s suggestion receipt.",
      );
    }, 180000);
    return () => clearTimeout(timer);
  }, [busy]);
  async function suggest() {
    if (!enabled || !goal.trim() || pending.current) return;
    const asked = { id: crypto.randomUUID(), ref: newRequestRef() };
    pending.current = asked;
    setBusy(true);
    setNotice("Preparing suggestions…");
    setSuggestions([]);
    const result = await workAsync("new-chat", {
      told: true,
      workAreaId: scope.areaId,
      sprint: { connection: scope.sourceId, id: "ado:" + scope.sprintId, name },
    }).catch(() => ({
      ok: false,
      message: "Could not open the sprint chat.",
      ref: "",
    }));
    if (pending.current !== asked) return;
    if (!result.ok || !result.ref) {
      pending.current = null;
      setBusy(false);
      setNotice(result.message);
      return;
    }
    bridge.send({
      version: 1,
      kind: "ado-operation",
      action: "suggest-sprint-stories",
      productId: scope.productId,
      sourceId: scope.sourceId,
      team: scope.team,
      level: scope.backlog,
      sprintId: scope.sprintId,
      workAreaId: scope.areaId,
      chatId: result.ref,
      goal: goal.trim(),
      tag,
      ref: asked.ref,
      requestId: asked.id,
    });
  }
  return (
    <section aria-label="Sprint goal">
      <label className="field">
        Sprint goal
        <textarea
          maxLength={2048}
          value={goal}
          disabled={busy}
          onChange={(e) => {
            const value = e.target.value;
            setGoal(value);
            setSuggestions([]);
            setNotice("");
            try {
              browserStore()?.setItem(key, value);
            } catch {
              setNotice("The goal is available for this visit.");
            }
          }}
        />
      </label>
      <button
        className="btn quiet"
        disabled={!enabled || busy || !goal.trim()}
        onClick={() => void suggest()}
      >
        Ask Firstmate for story suggestions
      </button>
      {notice && <p role="status">{notice}</p>}
      {suggestions.map((s) => {
        const card = cards.find((c) => c.id === s.id);
        if (!card) return null;
        const person = people.find((p) => p.id === s.ownerId),
          useOwner = person && owners.includes(s.id);
        return (
          <article key={s.id}>
            <h4>
              #{s.id} {card.title}
            </h4>
            <p>{s.reason}</p>
            <p>
              {card.iteration} ·{" "}
              {card.estimates?.map((e) => e.value + " " + e.name).join(", ") ||
                "Unestimated"}
            </p>
            {!!card.prerequisites?.length && (
              <p>
                Prerequisites ·{" "}
                {card.prerequisites.map((id) => "#" + id).join(", ")}
              </p>
            )}
            {person && (
              <label>
                <input
                  type="checkbox"
                  checked={owners.includes(s.id)}
                  onChange={(e) =>
                    setOwners(
                      e.target.checked
                        ? [...owners, s.id]
                        : owners.filter((id) => id !== s.id),
                    )
                  }
                />{" "}
                Assign {person.name} · owns prerequisite #{s.evidenceId}
              </label>
            )}
            <button
              className="btn"
              disabled={!enabled || card.rev !== s.rev || unavailable(s.id)}
              onClick={() =>
                stage(
                  card,
                  useOwner
                    ? { from: card.assigneeId ?? null, to: person }
                    : undefined,
                )
              }
            >
              Stage #{s.id} for {name}
            </button>
          </article>
        );
      })}
    </section>
  );
}
