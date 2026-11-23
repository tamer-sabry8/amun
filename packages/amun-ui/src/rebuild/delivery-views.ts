// The four ways into every delivery screen (approved by the owner on 23
// November 2026, docs/preview/2026-11-23-screens-and-ways-in): ask in the
// chat, Sprints, the Portfolio card and Activity all open the same screen
// beside the folder's chat. This file names those screens and works out the
// links and the one-line progress a card shows. Opening is navigation only.
import type { WorkSnapshot } from "../../../contracts/src/work.ts";
import { receiptOf } from "./publish-receipt.tsx";
import {
  progressOf,
  storyGroup,
} from "../../../domain/src/work/delivery-chain.ts";

export type DeliveryView =
  | "requirements"
  | "stories"
  | "sprint"
  | "receipt"
  | "release"
  | "roadmap"
  | "activity";

export interface DeliveryLink {
  view: DeliveryView;
  label: string;
  /** For a receipt: the message to open, in its chat. */
  messageId?: string;
  chatId?: string | null;
  /** For a release: the release tracker to open. */
  outputId?: string;
}

type Snap = Pick<
  WorkSnapshot,
  "delivery" | "sprints" | "library" | "roadmap" | "messages" | "chats"
>;

/** Every publish receipt of a work, newest last, with where it sits. */
export function receiptsOf(snapshot: Snap, areaId: string) {
  return [
    ...snapshot.messages
      .filter((message) => message.workAreaId === areaId)
      .map((message) => ({ message, chatId: null as string | null })),
    ...snapshot.chats
      .filter((chat) => chat.workAreaId === areaId)
      .flatMap((chat) =>
        chat.messages.map((message) => ({ message, chatId: chat.id })),
      ),
  ]
    .filter(({ message }) => receiptOf(message.card))
    .sort((a, b) => a.message.createdAt.localeCompare(b.message.createdAt))
    .map(({ message, chatId }) => ({
      messageId: message.id,
      chatId,
      planId: receiptOf(message.card)!.planId,
      card: receiptOf(message.card)!,
    }));
}

/** The "Open:" links of a product or project, in the approved order. */
export function deliveryLinks(snapshot: Snap, areaId: string): DeliveryLink[] {
  const summary = snapshot.delivery.find((item) => item.workAreaId === areaId);
  const links: DeliveryLink[] = [];
  if (summary?.requirements) {
    const r = summary.requirements;
    links.push({
      view: "requirements",
      label: `${r.label}${r.version ? ` v${r.version}` : ""}`,
    });
  }
  const stories = (summary?.items ?? []).filter(
    (item) =>
      item.type.toLowerCase() !== "epic" &&
      storyGroup(item.status) !== "removed",
  );
  if (summary && summary.delivery)
    links.push({ view: "stories", label: `Stories (${stories.length})` });
  const sprint = currentSprint(snapshot, areaId);
  if (sprint) links.push({ view: "sprint", label: sprint.name });
  const receipts = receiptsOf(snapshot, areaId);
  if (receipts.length) {
    const last = receipts.at(-1)!;
    links.push({
      view: "receipt",
      label: `Receipts (${receipts.length})`,
      messageId: last.messageId,
      chatId: last.chatId,
    });
  }
  const release = snapshot.library
    .filter(
      (item) =>
        item.section === "output" &&
        item.type === "release_tracker" &&
        item.workAreaIds.includes(areaId) &&
        item.status !== "Archived",
    )
    .at(-1);
  if (release)
    links.push({ view: "release", label: release.title, outputId: release.id });
  const onRoadmap = snapshot.roadmap.find((item) => item.workAreaId === areaId);
  if (onRoadmap)
    links.push({
      view: "roadmap",
      label: `On the roadmap: ${onRoadmap.horizon[0]!.toUpperCase()}${onRoadmap.horizon.slice(1)}`,
    });
  links.push({ view: "activity", label: "Activity" });
  return links;
}

/** The sprint running now, else the next one, else the latest. */
export function currentSprint(snapshot: Pick<Snap, "sprints">, areaId: string) {
  const now = Date.now();
  const mine = snapshot.sprints
    .filter((sprint) => sprint.workAreaId === areaId)
    .sort((a, b) => a.start.localeCompare(b.start));
  return (
    mine.find(
      (sprint) =>
        Date.parse(sprint.start) <= now && now <= Date.parse(sprint.end),
    ) ??
    mine.find((sprint) => Date.parse(sprint.start) > now) ??
    mine.at(-1) ??
    null
  );
}

/** "21 of 31 stories · 6 of 10 epics", or null with no stories. */
export function progressLine(snapshot: Snap, areaId: string): string | null {
  const summary = snapshot.delivery.find((item) => item.workAreaId === areaId);
  if (!summary) return null;
  const stories = summary.items.filter(
    (item) => item.type.toLowerCase() !== "epic",
  );
  const epics = summary.items.filter(
    (item) => item.type.toLowerCase() === "epic",
  );
  const all = progressOf(stories);
  if (!all.total) return null;
  const doneEpics = epics.filter(
    (epic) =>
      progressOf(stories.filter((story) => story.parentId === epic.id))
        .state === "done",
  ).length;
  return [
    `${all.done} of ${all.total} ${all.total === 1 ? "story" : "stories"} done`,
    epics.length ? `${doneEpics} of ${epics.length} epics` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
