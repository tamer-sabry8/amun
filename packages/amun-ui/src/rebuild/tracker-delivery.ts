// What each work area has in Jira and Linear, for the Stories tab and
// Sprints. Asked only for areas with an approved Jira or Linear plan, again
// every minute while shown; nothing here writes to a tracker.
import { useEffect, useMemo, useState } from "react";
import type {
  TrackerDeliveryItem,
  TrackerDeliveryResult,
} from "@amun/contracts";
import type { Snapshot } from "./view-model.ts";
import { bridge } from "../bridge.ts";
import type { Sprint } from "../../../../packages/domain/src/work/planning.ts";

const REFRESH_MS = 60_000;
const published = new Set([
  "approved",
  "publishing",
  "published",
  "partial",
  "failed",
]);

/** Areas with a Jira or Linear plan the captain approved. */
export function trackerAreas(snapshot: Snapshot, only?: string | null) {
  return [
    ...new Set(
      snapshot.plans
        .filter(
          (plan) =>
            (plan.destination === "jira" || plan.destination === "linear") &&
            published.has(plan.state) &&
            plan.workAreaId &&
            (!only || plan.workAreaId === only),
        )
        .map((plan) => plan.workAreaId!),
    ),
  ].sort();
}

export function useTrackerDelivery(areaIds: string[]) {
  const [byArea, setByArea] = useState<Record<string, TrackerDeliveryResult>>(
    {},
  );
  const key = areaIds.join(",");
  useEffect(
    () =>
      bridge.onEvent((raw) => {
        const event = raw as Partial<TrackerDeliveryResult>;
        if (event?.kind !== "tracker-delivery-result" || !event.workAreaId)
          return;
        setByArea((now) => ({
          ...now,
          [event.workAreaId!]: event as TrackerDeliveryResult,
        }));
      }),
    [],
  );
  useEffect(() => {
    if (!key) return;
    const ask = () => {
      for (const workAreaId of key.split(","))
        bridge.send({ version: 1, kind: "tracker-delivery", workAreaId });
    };
    ask();
    const timer = setInterval(ask, REFRESH_MS);
    return () => clearInterval(timer);
  }, [key]);
  return byArea;
}

const providerName = (item: TrackerDeliveryItem) =>
  item.provider === "jira" ? "Jira" : "Linear";

/** "SCRUM-17 Import attendees…", or the title alone before it exists there. */
export const itemLabel = (item: TrackerDeliveryItem) =>
  item.key && item.kind !== "sprint" ? `${item.key} ${item.title}` : item.title;

/**
 * Jira sprints and Linear cycles as Sprints entries, in the same shape as the
 * Azure ones, with their stories and the status the provider reports.
 */
export function trackerSprints(
  delivery: TrackerDeliveryResult,
  workAreaName: string,
): (Sprint & {
  stories: {
    id: string;
    title: string;
    points: number | null;
    owner: string | null;
    storyUrl?: string;
    state: string;
  }[];
  out: never[];
  capacity: null;
  provider: "jira" | "linear";
  url: string | null;
})[] {
  const created = delivery.items.filter(
    (item) => item.kind === "sprint" && item.outcome === "created",
  );
  // A sprint that exists only as a membership: an existing Jira sprint, or a
  // Linear cycle (Linear cannot create cycles, so it is never in a plan).
  const memberships = [
    ...new Set(
      delivery.items
        .filter((item) => item.kind === "story" && item.sprintId)
        .map((item) => item.sprintId!)
        .filter((id) => !created.some((sprint) => sprint.itemId === id)),
    ),
  ].flatMap((id) => {
    const match = /^(jira|linear):(sprint|cycle):(.+)$/.exec(id);
    if (!match) return [];
    const provider = match[1] as "jira" | "linear";
    return [
      {
        provider,
        planId: "",
        itemId: id,
        kind: "sprint" as const,
        type: provider === "linear" ? "Cycle" : "Sprint",
        title: `${provider === "linear" ? "Cycle" : "Sprint"} ${match[3]}`,
        acceptance: [],
        key: match[3]!,
        url: null,
        epicId: null,
        sprintId: null,
        status: null,
        start: null,
        end: null,
        outcome: "created" as const,
      },
    ];
  });
  const sprints = [...created, ...memberships];
  return sprints.map((sprint) => {
    const stories = delivery.items.filter(
      (item) => item.kind === "story" && item.sprintId === sprint.itemId,
    );
    const done = stories.filter((s) =>
      /^(done|closed|completed|resolved)$/i.test(s.status ?? ""),
    );
    const start = sprint.start ? new Date(sprint.start).toISOString() : "";
    const end = sprint.end
      ? new Date(Date.parse(sprint.end) + 86_400_000 - 1).toISOString()
      : "";
    return {
      id: `${sprint.provider}:${sprint.key ?? sprint.itemId}`,
      workAreaId: delivery.workAreaId,
      workAreaName,
      name: sprint.title,
      team: `${providerName(sprint)}${sprint.status ? ` · ${sprint.status}` : ""}`,
      start,
      end,
      goal: "",
      draft: false,
      done: done.length,
      total: stories.length,
      blocked: 0,
      changedInAdo: false,
      stories: stories.map((story) => ({
        id: `${story.provider}:${story.key ?? story.itemId}`,
        title: itemLabel(story),
        points: null,
        owner: null,
        ...(story.url ? { storyUrl: story.url } : {}),
        state: story.status ?? "Not read yet",
      })),
      out: [],
      capacity: null,
      provider: sprint.provider,
      url: sprint.url,
    };
  });
}

/** Epics with their stories, then stories under no epic, for the Stories tab. */
export function trackerEpics(delivery: TrackerDeliveryResult) {
  const items = delivery.items.filter((item) => item.outcome === "created");
  const epics = items.filter((item) => item.kind === "epic");
  const stories = items.filter((item) => item.kind === "story");
  const grouped = epics.map((epic) => ({
    epic,
    stories: stories.filter((story) => story.epicId === epic.itemId),
  }));
  const loose = stories.filter(
    (story) => !epics.some((epic) => epic.itemId === story.epicId),
  );
  return {
    grouped,
    loose,
    failed: delivery.items.filter((i) => i.outcome !== "created"),
  };
}

export function useTrackerSprints(snapshot: Snapshot, areaIds: string[]) {
  const delivery = useTrackerDelivery(areaIds);
  return useMemo(
    () =>
      areaIds.flatMap((id) =>
        delivery[id]
          ? trackerSprints(
              delivery[id]!,
              snapshot.areas.find((area) => area.id === id)?.name ?? "",
            )
          : [],
      ),
    [delivery, areaIds, snapshot.areas],
  );
}
