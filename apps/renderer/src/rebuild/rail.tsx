// Right rail (Q26, Q57–Q59): Activity · Downloads · Library · Decisions.
// Library and Decisions open scoped to the active work and can expand into
// the main workspace.
import { useState } from "react";
import {
  railItems,
  type RailItem,
} from "../../../../packages/domain/src/work/shell.ts";
import {
  decisionLog,
  library,
  type LibraryItem,
} from "../../../../packages/domain/src/work/planning.ts";
import { railLabel } from "../rail-label.ts";
import { Icon } from "../icons.tsx";
import { work } from "./store.ts";
import {
  areaOf,
  shortDate,
  visibleGroups,
  type Snapshot,
} from "./view-model.ts";

const typeNames: Record<string, string> = {
  prd: "PRD",
  brd: "BRD",
  research: "Research",
  prototype: "Prototype",
  deck: "Deck",
  update: "Update",
  doc: "Doc",
  council_report: "Council report",
  idea: "Idea",
  problem: "Problem",
  interview: "Interview",
  document: "Document",
  download: "Downloaded",
};
export const typeName = (type: string) => typeNames[type] ?? type;

export function Rail({
  open,
  running,
  waiting,
  downloads,
  onOpen,
}: {
  open: RailItem | null;
  running: number;
  waiting: number;
  downloads: number;
  onOpen(item: RailItem): void;
}) {
  const counts: Record<RailItem, number> = {
    activity: running,
    downloads,
    library: 0,
    decisions: waiting,
  };
  return (
    <aside
      className="rb-rail"
      aria-label="Activity, downloads, library and decisions"
    >
      {railItems.map(([id, label]) => (
        <button
          key={id}
          aria-label={
            id === "decisions" && counts[id] > 0
              ? `${railLabel(label)}, ${counts[id]} waiting on you`
              : railLabel(label, counts[id])
          }
          aria-expanded={open === id}
          title={label}
          onClick={() => onOpen(id)}
        >
          <Icon name={id} width={18} height={18} />
          {counts[id] > 0 && id !== "downloads" && (
            <span className="count">{counts[id]}</span>
          )}
        </button>
      ))}
    </aside>
  );
}

export function ActivityPanel({
  snapshot,
  onWork,
}: {
  snapshot: Snapshot;
  onWork(areaId: string): void;
}) {
  const groups = visibleGroups(snapshot);
  const items = snapshot.activity.filter(
    (item) => groups === null || !item.groupId || groups.includes(item.groupId),
  );
  // Running work stays pinned on top; the rest is newest first.
  const ordered = [
    ...items.filter((item) => item.state === "running"),
    ...items.filter((item) => item.state !== "running"),
  ];
  if (!ordered.length)
    return (
      <p className="muted">Nothing is running. Finished work appears here.</p>
    );
  return (
    <div>
      {ordered.map((item) => {
        const area = areaOf(snapshot, item.workAreaId);
        return (
          <div className="rb-line" key={item.id}>
            <span className={"dot " + item.state} aria-hidden="true" />
            <div>
              <div>{item.text}</div>
              <div className="muted small">
                {item.state === "running"
                  ? "Running"
                  : item.state === "failed"
                    ? "Did not finish"
                    : "Finished"}
                {area && " · "}
                {area && (
                  <button className="link" onClick={() => onWork(area.id)}>
                    {area.name}
                  </button>
                )}
              </div>
              {item.state === "running" && item.progress !== null && (
                <div
                  className="rb-progress"
                  role="progressbar"
                  aria-valuenow={Math.round(item.progress * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={item.text}
                >
                  <i style={{ width: `${item.progress * 100}%` }} />
                </div>
              )}
            </div>
            <span className="muted small">{shortDate(item.createdAt)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function DownloadsPanel({
  files,
  onViewAll,
}: {
  files: { id: string; name: string; type: string }[];
  onViewAll(): void;
}) {
  const [cleared, setCleared] = useState<string[]>([]);
  const visible = files.filter((file) => !cleared.includes(file.id));
  return (
    <>
      <header>
        <h2>Recent downloads</h2>
        <button
          className="btn quiet"
          disabled={!visible.length}
          onClick={() => setCleared(files.map((file) => file.id))}
        >
          Clear
        </button>
      </header>
      <div className="body">
        {visible.length ? (
          <div>
            {visible.slice(0, 8).map((file) => (
              <div className="rb-line" key={file.id}>
                <Icon name="prd" width={18} height={18} />
                <div>
                  <div
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {file.name}
                  </div>
                  <div className="muted small">{file.type}</div>
                </div>
                <button
                  className="icon-btn"
                  aria-label={`Show ${file.name} in Library`}
                  onClick={onViewAll}
                >
                  <Icon name="search" width={16} height={16} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Exports and downloads will appear here.</p>
        )}
      </div>
      <footer>
        <button className="link" onClick={onViewAll}>
          View all downloads
          <Icon name="external" width={14} height={14} />
        </button>
      </footer>
    </>
  );
}

export function LibraryPanel({
  snapshot,
  workAreaId,
  initialType = null,
  extra = [],
  onOpen,
  onWork,
}: {
  snapshot: Snapshot;
  workAreaId: string | null;
  initialType?: string | null;
  /** Exports and downloads from earlier flows, shown as Downloaded. */
  extra?: LibraryItem[];
  onOpen(item: LibraryItem): void;
  onWork(areaId: string): void;
}) {
  const [all, setAll] = useState(workAreaId === null);
  const [type, setType] = useState<string | null>(initialType);
  const [needs, setNeeds] = useState(false);
  const [text, setText] = useState("");
  const [linking, setLinking] = useState<string | null>(null);
  const view = snapshot.setup.libraryView;
  const groupBy = snapshot.setup.libraryGroupBy;
  const items: LibraryItem[] = [...snapshot.library, ...extra];
  const scope = {
    workAreaId: all ? null : workAreaId,
    groupIds: visibleGroups(snapshot),
  };
  const types = [
    ...new Set(
      library(items, scope).flatMap((group) =>
        group.items.map((item) => item.type),
      ),
    ),
  ];
  const groups = library(items, {
    ...scope,
    type,
    needsLinking: needs,
    text,
    groupBy,
  });
  const empty = groups.every((group) => !group.items.length);
  const areas = snapshot.areas.filter((area) => {
    const allowed = visibleGroups(snapshot);
    return allowed === null || !area.groupId || allowed.includes(area.groupId);
  });
  return (
    <>
      <div className="row wrap">
        <input
          type="text"
          className="grow"
          aria-label="Search the library"
          placeholder="Search outputs and records"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="rb-seg" role="group" aria-label="View">
          <button
            aria-pressed={view === "gallery"}
            aria-label="Gallery"
            onClick={() => work("setup", { patch: { libraryView: "gallery" } })}
          >
            <Icon name="grid" width={15} height={15} />
          </button>
          <button
            aria-pressed={view === "list"}
            aria-label="List"
            onClick={() => work("setup", { patch: { libraryView: "list" } })}
          >
            <Icon name="list" width={15} height={15} />
          </button>
        </div>
      </div>
      <div className="row wrap">
        <button
          className={"rb-chip" + (type === null && !needs ? " on" : "")}
          aria-pressed={type === null && !needs}
          onClick={() => {
            setType(null);
            setNeeds(false);
          }}
        >
          All
        </button>
        {types.map((entry) => (
          <button
            key={entry}
            className="rb-chip"
            aria-pressed={type === entry}
            onClick={() => setType(type === entry ? null : entry)}
          >
            {typeName(entry)}
          </button>
        ))}
        <button
          className="rb-chip"
          aria-pressed={needs}
          onClick={() => setNeeds(!needs)}
        >
          Needs linking
        </button>
      </div>
      <div className="row wrap small">
        <label className="row muted">
          Group by
          <select
            value={groupBy}
            onChange={(event) =>
              work("setup", {
                patch: {
                  libraryGroupBy: event.target.value as
                    "work" | "type" | "none",
                },
              })
            }
          >
            <option value="work">Work area</option>
            <option value="type">Type</option>
            <option value="none">None</option>
          </select>
        </label>
        {workAreaId && (
          <button className="link" onClick={() => setAll(!all)}>
            {all
              ? `Only ${areaOf(snapshot, workAreaId)?.name ?? "this work"}`
              : "Browse all permitted"}
          </button>
        )}
      </div>
      {empty && (
        <p className="muted">
          {needs
            ? "Nothing is waiting to be linked."
            : "Outputs and records for this work will appear here."}
        </p>
      )}
      {groups.map(
        (group) =>
          group.items.length > 0 && (
            <section key={group.key} style={{ display: "grid", gap: 8 }}>
              {groupBy !== "none" && (
                <h3 className="muted small">
                  {groupBy === "type"
                    ? typeName(group.key)
                    : (areaOf(snapshot, group.key)?.name ??
                      "Not linked to work")}
                </h3>
              )}
              <div className={view === "gallery" ? "rb-gallery" : ""}>
                {group.items.map((item) =>
                  view === "gallery" ? (
                    <button
                      className="rb-doc"
                      key={group.key + item.id}
                      onClick={() => onOpen(item)}
                    >
                      <span className="preview">
                        {(item as LibraryItem & { body?: string }).body ||
                          typeName(item.type)}
                      </span>
                      <span className="name">{item.title}</span>
                      <span className="row">
                        <span
                          className={"tag" + (item.needsLinking ? " warn" : "")}
                        >
                          {item.needsLinking ? "Needs linking" : item.status}
                        </span>
                      </span>
                    </button>
                  ) : (
                    <div className="rb-line" key={group.key + item.id}>
                      <Icon
                        name={item.section === "record" ? "library" : "prd"}
                        width={18}
                        height={18}
                      />
                      <div>
                        <button className="link" onClick={() => onOpen(item)}>
                          {item.title}
                        </button>
                        <div className="muted small">
                          {typeName(item.type)} · {shortDate(item.updatedAt)}
                        </div>
                      </div>
                      <span
                        className={"tag" + (item.needsLinking ? " warn" : "")}
                      >
                        {item.needsLinking ? "Needs linking" : item.status}
                      </span>
                    </div>
                  ),
                )}
              </div>
              {group.items
                .filter(
                  (item) => item.needsLinking && item.section === "record",
                )
                .map((item) =>
                  linking === item.id ? (
                    <div className="rb-inline" key={"link" + item.id}>
                      <strong>Where does “{item.title}” belong?</strong>
                      <div className="row wrap">
                        {areas.map((area) => (
                          <button
                            key={area.id}
                            className="btn"
                            onClick={() => {
                              work("link-record", {
                                recordId: item.id,
                                choice: "link",
                                workAreaIds: [...item.workAreaIds, area.id],
                              });
                              setLinking(null);
                            }}
                          >
                            {area.name}
                          </button>
                        ))}
                        <button
                          className="btn quiet"
                          onClick={() => {
                            work("link-record", {
                              recordId: item.id,
                              choice: "never",
                            });
                            setLinking(null);
                          }}
                        >
                          Leave unlinked
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      key={"ask" + item.id}
                      className="link small"
                      style={{ justifySelf: "start" }}
                      onClick={() => setLinking(item.id)}
                    >
                      Link “{item.title}”
                    </button>
                  ),
                )}
            </section>
          ),
      )}
      {/* onWork keeps the panel honest about where an item lives */}
      {!all && workAreaId && (
        <button
          className="link small"
          style={{ justifySelf: "start" }}
          onClick={() => onWork(workAreaId)}
        >
          Back to the conversation
        </button>
      )}
    </>
  );
}

export function DecisionsPanel({
  snapshot,
  workAreaId,
  onReview,
}: {
  snapshot: Snapshot;
  workAreaId: string | null;
  /** Pending items are answered through the Island or their review, not here. */
  onReview(decisionId: string): void;
}) {
  const [all, setAll] = useState(workAreaId === null);
  const log = decisionLog(snapshot.decisions, {
    workAreaId: all ? null : workAreaId,
    groupIds: visibleGroups(snapshot),
  });
  const by = {
    you: "You",
    client: "Client",
    firstmate_recommended: "Firstmate recommended",
  };
  const source = {
    council: "Council",
    exception: "Exception",
    conversation: null,
  };
  return (
    <>
      {workAreaId && (
        <button
          className="link small"
          style={{ justifySelf: "start" }}
          onClick={() => setAll(!all)}
        >
          {all
            ? `Only ${areaOf(snapshot, workAreaId)?.name ?? "this work"}`
            : "Browse all permitted"}
        </button>
      )}
      <section style={{ display: "grid", gap: 6 }}>
        <h3>Waiting on you</h3>
        {log.waiting.length ? (
          log.waiting.map((decision) => (
            <div className="rb-inline" key={decision.id}>
              <div className="row">
                <strong className="grow">{decision.what}</strong>
                {source[decision.source] && (
                  <span className="tag accent">{source[decision.source]}</span>
                )}
              </div>
              {decision.options.map((option) => (
                <p key={option} className="small">
                  {option}
                </p>
              ))}
              <button
                className="btn"
                style={{ justifySelf: "start" }}
                onClick={() => onReview(decision.id)}
              >
                Review
              </button>
            </div>
          ))
        ) : (
          <p className="muted">No proposals are waiting.</p>
        )}
      </section>
      <section style={{ display: "grid", gap: 2 }}>
        <h3>Decision log</h3>
        {log.recorded.length ? (
          log.recorded.map((decision) => (
            <div className="rb-line" key={decision.id}>
              <Icon name="decisions" width={18} height={18} />
              <div>
                <div>{decision.what}</div>
                <div className="small">{decision.outcome}</div>
                <div className="muted small">
                  {decision.decidedBy ? by[decision.decidedBy] : ""}
                  {decision.decidedAt && " · " + shortDate(decision.decidedAt)}
                  {decision.affected.length > 0 &&
                    " · affects " + decision.affected.join(", ")}
                </div>
              </div>
              {source[decision.source] && (
                <span
                  className={
                    "tag" + (decision.source === "exception" ? " warn" : "")
                  }
                >
                  {source[decision.source]}
                </span>
              )}
            </div>
          ))
        ) : (
          <p className="muted">
            Decisions you make are recorded here so they are not asked twice.
          </p>
        )}
      </section>
    </>
  );
}
