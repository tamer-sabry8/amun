import { readableCriteria } from "./planning-fields.tsx";
import { useState } from "react";
import type { BacklogResult, PlannedStory } from "@amun/contracts";
export function PlannedStoryRow({
  story,
  name,
  matches,
  people,
  useExisting,
  update,
  remove,
  focus,
}: {
  story: PlannedStory;
  name: string;
  matches: readonly (Extract<
    BacklogResult,
    { view: "cards" }
  >["cards"][number] & { outside?: string })[];
  people: readonly { id: string; name: string }[];
  useExisting(
    id: number,
    rev: number,
    labels: string[],
    schedule: boolean,
    owner: string,
    criteria: string | null,
  ): void;
  update(next: PlannedStory): void;
  remove(): void;
  focus: boolean;
}) {
  const [existing, setExisting] = useState<number | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [schedule, setSchedule] = useState(false);
  const [rev, setRev] = useState(0);
  const [owner, setOwner] = useState("");
  const [wording, setWording] = useState<string | null>(null);
  const matched = matches.find((m) => m.id === existing);
  function select(m: (typeof matches)[number], edit: boolean) {
    setExisting(m.id);
    setRev(m.rev);
    setLabels([]);
    setOwner("");
    setSchedule(false);
    setWording(edit ? readableCriteria(m.criteria ?? "") : null);
  }
  return (
    <article
      className="rb-inline"
      aria-label="New backlog story"
      draggable
      onDragStart={(e) =>
        e.dataTransfer.setData("text/amun-draft-story", story.localId)
      }
    >
      <label className="field">
        Story title
        <input
          autoFocus={focus}
          value={story.title}
          maxLength={256}
          onChange={(e) =>
            update({ ...story, title: e.target.value, separate: false })
          }
        />
      </label>
      <details>
        <summary>Story details</summary>
        <label className="field">
          Acceptance criteria
          <textarea
            value={story.criteria.join("\n")}
            placeholder="One criterion per line"
            onChange={(e) =>
              update({ ...story, criteria: e.target.value.split("\n") })
            }
          />
        </label>
        <label className="field">
          Labels
          <input
            value={story.labels.join(";")}
            placeholder="Separate labels with a semicolon"
            onChange={(e) =>
              update({ ...story, labels: e.target.value.split(";") })
            }
          />
        </label>
      </details>
      <div className="row wrap">
        <label>
          <input
            type="checkbox"
            checked={story.schedule}
            onChange={(e) => update({ ...story, schedule: e.target.checked })}
          />{" "}
          Add to {name}
        </label>
        <button className="btn quiet" onClick={remove}>
          Discard draft
        </button>
      </div>
      {!!matches.length && (
        <div>
          <h4>Possible duplicates</h4>
          {matches.map((m) => (
            <div className="rb-inline" key={m.id}>
              #{m.id} {m.title}{" "}
              {m.outside && (
                <span className="muted small">Outside {m.outside} filter</span>
              )}
              <p>
                Existing criteria ·{" "}
                {m.readableCriteria
                  ? readableCriteria(m.criteria ?? "") || "Empty"
                  : "Unavailable"}
              </p>
              <p>
                Draft criteria ·{" "}
                {story.criteria.filter(Boolean).join(" · ") || "Empty"}
              </p>
              <button
                className="btn quiet"
                disabled={!m.readableCriteria}
                onClick={() => select(m, true)}
              >
                Edit existing story #{m.id}
              </button>
              <button className="btn quiet" onClick={() => select(m, false)}>
                Use existing story #{m.id}
              </button>
            </div>
          ))}
          {matches.some((m) => m.id === existing) && existing !== null && (
            <fieldset>
              <legend>
                Review changes to #{existing} · revision {rev}
              </legend>
              {wording !== null && (
                <label className="field">
                  Reviewed acceptance criteria
                  <textarea
                    maxLength={16000}
                    value={wording}
                    onChange={(e) => setWording(e.target.value)}
                  />
                </label>
              )}
              {!!people.length && (
                <label className="field">
                  Owner
                  <select
                    disabled={!!matched?.assignee && !matched.assigneeId}
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                  >
                    <option value="">Keep current owner</option>
                    {people
                      .filter((p) => p.id !== matched?.assigneeId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {[
                ...new Set(story.labels.map((l) => l.trim()).filter(Boolean)),
              ].map((label) => (
                <label key={label}>
                  <input
                    type="checkbox"
                    checked={labels.includes(label)}
                    onChange={(e) =>
                      setLabels(
                        e.target.checked
                          ? [...labels, label]
                          : labels.filter((l) => l !== label),
                      )
                    }
                  />{" "}
                  Add label {label}
                </label>
              ))}
              <label>
                <input
                  type="checkbox"
                  checked={schedule}
                  onChange={(e) => setSchedule(e.target.checked)}
                />{" "}
                Add to {name}
              </label>
              <button
                className="btn"
                disabled={!matched || matched.rev !== rev}
                onClick={() =>
                  useExisting(
                    existing,
                    rev,
                    labels.filter((l) =>
                      story.labels.some((s) => s.trim() === l),
                    ),
                    schedule,
                    owner,
                    wording !== null &&
                      wording !== readableCriteria(matched?.criteria ?? "")
                      ? wording
                      : null,
                  )
                }
              >
                Use #{existing} and discard the new story draft
              </button>
            </fieldset>
          )}
          <label>
            <input
              type="checkbox"
              checked={story.separate === true}
              onChange={(e) => update({ ...story, separate: e.target.checked })}
            />{" "}
            Create a separate story
          </label>
        </div>
      )}
    </article>
  );
}
