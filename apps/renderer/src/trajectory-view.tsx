import { useState } from "react";
import {
  eventContext,
  filterEvents,
  groupBySource,
  resumeBrief,
  sourceLabels,
  sourceQuestions,
  trajectorySources,
  type BranchSummary,
  type ReplayComparison,
  type TrajectoryEvent,
  type TrajectorySource,
} from "../../../packages/domain/src/trajectory.ts";

const stateLabels = {
  empty: "Nothing recorded yet",
  in_progress: "In progress",
  awaiting_approval: "Waiting for approval",
  failed: "Stopped on an error",
  completed: "Completed",
} as const;

function detailText(detail: unknown): string {
  if (detail === null || detail === undefined) return "";
  if (typeof detail === "string") return detail;
  const text = JSON.stringify(detail, null, 2);
  return text === "{}" ? "" : text;
}

function EventRow({
  event,
  events,
  onOpen,
}: {
  event: TrajectoryEvent;
  events: readonly TrajectoryEvent[];
  onOpen?: (id: string) => void;
}) {
  const context = eventContext(events, event.id, 0);
  const detail = detailText(event.detail);
  return (
    <li
      className={"trajectory-event source-" + event.source}
      id={"trajectory-" + event.id}
      data-event-id={event.id}
    >
      <div className="trajectory-meta">
        <span className="trajectory-seq">#{event.seq}</span>
        <span className="type-label">{sourceLabels[event.source]}</span>
        <span>{event.participant}</span>
        <time dateTime={event.at}>{event.at}</time>
        {event.tool && <span>Tool: {event.tool}</span>}
        {event.status && <span>Status: {event.status}</span>}
      </div>
      <p className="trajectory-summary">{event.summary}</p>
      {context?.refers && (
        <p className="muted">
          Follows{" "}
          <a
            href={"#trajectory-" + context.refers.id}
            onClick={() => onOpen?.(context.refers!.id)}
          >
            #{context.refers.seq} {context.refers.summary}
          </a>
        </p>
      )}
      {context && context.followUps.length > 0 && (
        <p className="muted">
          Followed by{" "}
          {context.followUps.map((next) => (
            <a
              key={next.id}
              href={"#trajectory-" + next.id}
              onClick={() => onOpen?.(next.id)}
            >
              #{next.seq}{" "}
            </a>
          ))}
        </p>
      )}
      {detail && (
        <details>
          <summary>Details for event {event.seq}</summary>
          <pre>{detail}</pre>
        </details>
      )}
    </li>
  );
}

interface Props {
  title: string;
  events: readonly TrajectoryEvent[];
  branches?: readonly (BranchSummary & { title: string; preferred: boolean })[];
  replay?: ReplayComparison;
  initialText?: string;
  initialSources?: readonly TrajectorySource[];
  initialGrouped?: boolean;
  onFork?(eventId: string): void;
  onPromote?(sessionId: string): void;
}

/** The record of one session, filterable and grouped by where events came from. */
export function TrajectoryView(props: Props) {
  const [text, setText] = useState(props.initialText ?? "");
  const [sources, setSources] = useState<readonly TrajectorySource[]>(
    props.initialSources ?? [],
  );
  const [grouped, setGrouped] = useState(props.initialGrouped ?? false);
  const brief = resumeBrief(props.events);
  const shown = filterEvents(props.events, { text, sources });
  const present = trajectorySources.filter((source) =>
    props.events.some((event) => event.source === source),
  );
  const list = (events: readonly TrajectoryEvent[]) => (
    <ol className="trajectory-list">
      {events.map((event) => (
        <EventRow key={event.id} event={event} events={props.events} />
      ))}
    </ol>
  );
  return (
    <section className="trajectory" aria-label={"Trajectory of " + props.title}>
      <h2>Trajectory · {props.title}</h2>
      <p className="trajectory-state" data-state={brief.state}>
        {stateLabels[brief.state]} · {props.events.length} events
        {brief.approvalsNeeded.length > 0 &&
          ` · ${brief.approvalsNeeded.length} approval needed`}
        {brief.incomplete.length > 0 &&
          ` · ${brief.incomplete.length} step unfinished`}
        {brief.openErrors.length > 0 &&
          ` · ${brief.openErrors.length} error open`}
      </p>
      <div className="trajectory-filters" role="search">
        <label>
          Search this session
          <input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <fieldset>
          <legend>Show</legend>
          {present.map((source) => (
            <label key={source} title={sourceQuestions[source]}>
              <input
                type="checkbox"
                checked={sources.includes(source)}
                onChange={() =>
                  setSources(
                    sources.includes(source)
                      ? sources.filter((s) => s !== source)
                      : [...sources, source],
                  )
                }
              />
              {sourceLabels[source]}
            </label>
          ))}
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={grouped}
            onChange={() => setGrouped(!grouped)}
          />
          Group by source
        </label>
      </div>
      <p className="muted" aria-live="polite">
        {shown.length === props.events.length
          ? "Showing every event"
          : `Showing ${shown.length} of ${props.events.length} events`}
      </p>
      {shown.length === 0 ? (
        <p className="muted">No events match.</p>
      ) : grouped ? (
        groupBySource(shown).map((group) => (
          <section key={group.source} aria-label={group.label}>
            <h3>
              {group.label} · {group.events.length}
              <span className="muted"> {sourceQuestions[group.source]}</span>
            </h3>
            {list(group.events)}
          </section>
        ))
      ) : (
        list(shown)
      )}
      {props.onFork && props.events.length > 0 && (
        <button
          type="button"
          className="text-button"
          onClick={() => props.onFork?.(props.events.at(-1)!.id)}
        >
          Branch from the latest event
        </button>
      )}
      {props.branches && props.branches.length > 1 && (
        <table className="trajectory-branches">
          <caption>Branches of this session</caption>
          <thead>
            <tr>
              <th scope="col">Branch</th>
              <th scope="col">Result</th>
              <th scope="col">Tool calls</th>
              <th scope="col">Errors</th>
              <th scope="col">Cost</th>
              <th scope="col">Duration</th>
              <th scope="col">Preferred</th>
            </tr>
          </thead>
          <tbody>
            {props.branches.map((branch) => (
              <tr key={branch.sessionId}>
                <th scope="row">{branch.title}</th>
                <td>{branch.result ?? stateLabels[branch.state]}</td>
                <td>{branch.toolCalls}</td>
                <td>{branch.errors}</td>
                <td>{(branch.costMicros / 1_000_000).toFixed(2)}</td>
                <td>{Math.round(branch.durationMs / 1000)} s</td>
                <td>
                  {branch.preferred ? (
                    "Preferred"
                  ) : (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => props.onPromote?.(branch.sessionId)}
                    >
                      Prefer {branch.title}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {props.replay && (
        <section className="trajectory-replay" aria-label="Replay result">
          <h3>
            {props.replay.mode === "reconstruction"
              ? "Replay · reconstruction of the stored record"
              : "Replay · new run, results may differ"}
          </h3>
          <p>
            {props.replay.reproduced
              ? "The outcome was reproduced."
              : "The outcome was not reproduced."}
          </p>
          {props.replay.changedConditions.length > 0 && (
            <ul aria-label="What changed since the original run">
              {props.replay.changedConditions.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          )}
          {props.replay.differences.length > 0 && (
            <ol aria-label="Steps that differ">
              {props.replay.differences.map((difference) => (
                <li key={difference.step}>
                  Step {difference.step}: {difference.original ?? "nothing"} →{" "}
                  {difference.replay ?? "nothing"}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </section>
  );
}
