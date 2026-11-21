import { useState } from "react";
import type { PlannedStory } from "@amun/contracts";
export function PlannedStoryRow({
  story,
  name,
  matches,
  useExisting,
  update,
  remove,
  focus,
}: {
  story: PlannedStory;
  name: string;
  matches: readonly { id: number; title: string; outside?: string }[];
  useExisting(id: number, labels: string[], schedule: boolean): void;
  update(next: PlannedStory): void;
  remove(): void;
  focus: boolean;
}) {
  const [existing, setExisting] = useState<number | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [schedule, setSchedule] = useState(false);
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
            <p key={m.id}>
              #{m.id} {m.title}{" "}
              {m.outside && (
                <span className="muted small">Outside {m.outside} filter</span>
              )}
              <button
                className="btn quiet"
                onClick={() => {
                  setExisting(m.id);
                  setLabels([]);
                  setSchedule(false);
                }}
              >
                Use existing story #{m.id}
              </button>
            </p>
          ))}
          {matches.some((m) => m.id === existing) && existing !== null && (
            <fieldset>
              <legend>Review changes to #{existing}</legend>
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
                onClick={() => useExisting(existing, labels, schedule)}
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
