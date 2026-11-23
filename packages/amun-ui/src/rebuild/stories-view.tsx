// The Stories screen (Idea to Done §4.5; design approved by the owner on
// 23 November 2026, docs/preview/2026-11-23-screens-and-ways-in): one list
// for Products and Projects. Every story says where it is, Drafted (in Amun
// only) or Published (in Jira, Linear or Azure DevOps with its key), and its
// status. Epics are groups with "n of m done". Read only: publishing stays a
// plan the owner approves, and a published story's status changes in its tool.
import { useState } from "react";
import type { WorkSnapshot } from "../../../contracts/src/work.ts";
import {
  progressOf,
  storyGroup,
} from "../../../domain/src/work/delivery-chain.ts";

export type StoriesFilter = "all" | "drafted" | "published" | "done";

const toolName: Record<string, string> = {
  jira: "Jira",
  linear: "Linear",
  ado: "Azure DevOps",
};

export interface StoryRow {
  id: string;
  title: string;
  published: boolean;
  tool: string | null;
  key: string | null;
  status: string;
  sprint: string | null;
}
export interface StoryGroupRow {
  id: string | null;
  title: string;
  key: string | null;
  done: number;
  total: number;
  stories: StoryRow[];
}

/** Epics with their stories, then stories under no epic; filtered. */
export function storiesView(
  summary: WorkSnapshot["delivery"][number],
  sprints: WorkSnapshot["sprints"],
  filter: StoriesFilter,
): {
  groups: StoryGroupRow[];
  counts: Record<StoriesFilter, number>;
  tools: string[];
} {
  const epics = summary.items.filter(
    (item) => item.type.toLowerCase() === "epic",
  );
  const stories = summary.items.filter(
    (item) => item.type.toLowerCase() !== "epic",
  );
  const sprintOf = (story: { id: string; title: string; key: string | null }) =>
    sprints.find(
      (sprint) =>
        sprint.workAreaId === summary.workAreaId &&
        sprint.stories.some(
          (planned) =>
            planned.id === story.id ||
            (story.key !== null && planned.id === story.key) ||
            planned.title.toLowerCase() === story.title.toLowerCase(),
        ),
    )?.name ?? null;
  const row = (story: (typeof stories)[number]): StoryRow => ({
    id: story.id,
    title: story.title,
    published: story.key !== null,
    tool: story.tool,
    key: story.key,
    status: story.status,
    sprint: sprintOf(story),
  });
  const matches = (story: StoryRow) =>
    filter === "all" ||
    (storyGroup(story.status) !== "removed" &&
      ((filter === "drafted" && !story.published) ||
        (filter === "published" && story.published) ||
        (filter === "done" && storyGroup(story.status) === "done")));
  const counted = stories.filter(
    (story) => storyGroup(story.status) !== "removed",
  );
  const counts: Record<StoriesFilter, number> = {
    all: counted.length,
    drafted: counted.filter((story) => story.key === null).length,
    published: counted.filter((story) => story.key !== null).length,
    done: counted.filter((story) => storyGroup(story.status) === "done").length,
  };
  const group = (
    id: string | null,
    title: string,
    key: string | null,
    members: typeof stories,
  ): StoryGroupRow => {
    const progress = progressOf(members);
    return {
      id,
      title,
      key,
      done: progress.done,
      total: progress.total,
      stories: members.map(row).filter(matches),
    };
  };
  const groups = [
    ...epics.map((epic) =>
      group(
        epic.id,
        epic.title,
        epic.key,
        stories.filter((story) => story.parentId === epic.id),
      ),
    ),
    group(
      null,
      "Not in an epic",
      null,
      stories.filter(
        (story) =>
          !story.parentId || !epics.some((epic) => epic.id === story.parentId),
      ),
    ),
  ].filter((item) => item.stories.length > 0);
  const tools = [
    ...new Set(summary.items.flatMap((item) => (item.tool ? [item.tool] : []))),
  ].map((tool) => toolName[tool] ?? tool);
  return { groups, counts, tools };
}

const statusTone = (status: string) =>
  storyGroup(status) === "done" ? "good" : "";

export function StoriesView({
  snapshot,
  areaId,
  initialFilter = "all",
  onReceipt,
}: {
  snapshot: WorkSnapshot;
  areaId: string;
  initialFilter?: StoriesFilter;
  /** Jumps to the latest publish receipt of this work, when there is one. */
  onReceipt?: (() => void) | undefined;
}) {
  const [filter, setFilter] = useState<StoriesFilter>(initialFilter);
  const summary = snapshot.delivery.find((item) => item.workAreaId === areaId);
  if (!summary)
    return (
      <p className="muted" role="status">
        This work has no stories yet. Ask Firstmate to draft them from the
        approved PRD or BRD.
      </p>
    );
  const view = storiesView(summary, snapshot.sprints, filter);
  const requirements = summary.requirements;
  const label = requirements
    ? `${requirements.label}${requirements.version ? ` v${requirements.version}` : ""}`
    : null;
  return (
    <div className="rb-stories">
      <div className="row">
        <strong className="grow rb-stories-title">
          {view.counts.all} {view.counts.all === 1 ? "story" : "stories"}
          {label ? ` · from ${label}` : ""}
        </strong>
        <span className="muted small">
          {view.tools.length
            ? `Published to ${view.tools.join(" and ")}`
            : "Drafted in Amun only"}
        </span>
      </div>
      <div className="rb-seg" role="group" aria-label="Show stories">
        {(
          [
            ["all", "All"],
            ["drafted", "Drafted"],
            ["published", "Published"],
            ["done", "Done"],
          ] as const
        ).map(([id, name]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {name} <span className="count">{view.counts[id]}</span>
          </button>
        ))}
      </div>
      {view.groups.length === 0 ? (
        <p className="muted small" role="status">
          No {filter === "all" ? "" : `${filter} `}stories.
        </p>
      ) : (
        <table className="rb-receipt rb-stories-table">
          <thead>
            <tr>
              <th>Story</th>
              <th>Where</th>
              <th>Status</th>
              <th>Sprint</th>
            </tr>
          </thead>
          {view.groups.map((group) => (
            <tbody key={group.id ?? "loose"}>
              <tr className="rb-epic-row">
                <td colSpan={4}>
                  <span>{group.title}</span>
                  {group.key && <span className="muted"> · {group.key}</span>}
                  <span
                    className="rb-prog"
                    role="img"
                    aria-label={`${group.done} of ${group.total} done`}
                  >
                    <i
                      style={{
                        width: group.total
                          ? `${Math.round((group.done / group.total) * 100)}%`
                          : "0%",
                      }}
                    />
                  </span>
                  <span className="muted small">
                    {group.done} of {group.total} done
                  </span>
                </td>
              </tr>
              {group.stories.map((story) => (
                <tr key={story.id}>
                  <td>{story.title}</td>
                  <td>
                    {story.published ? (
                      <span className="tag info">Published · {story.key}</span>
                    ) : (
                      <span className="tag accent">Drafted</span>
                    )}
                  </td>
                  <td>
                    {story.published ? (
                      <span className={"tag " + statusTone(story.status)}>
                        {story.status}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="muted">{story.sprint ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      )}
      {(view.counts.drafted > 0 || onReceipt) && (
        <div className="row small">
          {view.counts.drafted > 0 && (
            <span className="muted grow">
              {view.counts.drafted} drafted{" "}
              {view.counts.drafted === 1 ? "story is" : "stories are"} in Amun
              only. Ask Firstmate to publish them; it raises a plan for your
              approval.
            </span>
          )}
          {onReceipt && (
            <button className="link small" type="button" onClick={onReceipt}>
              Open receipt
            </button>
          )}
        </div>
      )}
    </div>
  );
}
