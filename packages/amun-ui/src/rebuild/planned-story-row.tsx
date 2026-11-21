import type { PlannedStory } from "@amun/contracts";
export function PlannedStoryRow({
  story,
  name,
  matches,
  update,
  remove,
  focus,
}: {
  story: PlannedStory;
  name: string;
  matches: readonly { id: number; title: string; outside?: string }[];
  update(next: PlannedStory): void;
  remove(): void;
  focus: boolean;
}) {
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
            </p>
          ))}
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
