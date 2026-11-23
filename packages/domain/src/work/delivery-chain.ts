// Idea to Done (owner approval, 23 November 2026,
// docs/plans/2026-11-23-idea-to-done-requirements.md §2 and §4.9–4.13).
// Progress flows up the chain: stories set their epic, epics and the release
// set the requirements, and those set the roadmap item. Nothing here writes
// to a tool; closing anything outside Amun needs the captain's close-out.

/** The four story groups every screen uses, plus Removed. */
export type StoryGroup =
  "todo" | "in_progress" | "in_review" | "done" | "removed";

export const storyStatusWords: Record<StoryGroup, string> = {
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  removed: "Removed",
};

const groups: [StoryGroup, RegExp][] = [
  [
    "removed",
    /^(removed|cut|won't do|wont do|cancel(l)?ed|duplicate|rejected)$/,
  ],
  ["done", /^(done|closed|resolved|completed?|shipped|released|accepted)$/],
  [
    "in_review",
    /^(in review|review|code review|in qa|qa|testing|in test|ready for review)$/,
  ],
  [
    "in_progress",
    /^(in progress|active|doing|started|committed|in development|development|blocked)$/,
  ],
];

/**
 * Which group a status belongs to. A tool's own names are kept on screen;
 * this only decides where they count. Anything unknown counts as To do, so
 * progress is never overstated.
 */
export function storyGroup(status: string | null | undefined): StoryGroup {
  const word = String(status ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  for (const [group, pattern] of groups) if (pattern.test(word)) return group;
  return "todo";
}

export interface ChainStory {
  id: string;
  status: string | null;
}

export interface Progress {
  done: number;
  /** Stories that count: everything except Removed. */
  total: number;
  state: "not_started" | "in_progress" | "done";
}

/** "n of m done" for an epic, a release or a roadmap item. */
export function progressOf(stories: ChainStory[]): Progress {
  const counted = stories.filter(
    (story) => storyGroup(story.status) !== "removed",
  );
  const done = counted.filter(
    (story) => storyGroup(story.status) === "done",
  ).length;
  const started = counted.some((story) => storyGroup(story.status) !== "todo");
  return {
    done,
    total: counted.length,
    state:
      counted.length > 0 && done === counted.length
        ? "done"
        : started
          ? "in_progress"
          : "not_started",
  };
}

export interface ReleaseReadiness {
  ready: boolean;
  notDone: string[];
}

/**
 * Schedule is enabled only when every story the release ships is Done or
 * Removed (§4.10). A release that ships nothing is not ready.
 */
export function releaseReadiness(stories: ChainStory[]): ReleaseReadiness {
  const notDone = stories
    .filter((story) => !["done", "removed"].includes(storyGroup(story.status)))
    .map((story) => story.id);
  const counted = stories.filter(
    (story) => storyGroup(story.status) !== "removed",
  );
  return { ready: counted.length > 0 && notDone.length === 0, notDone };
}

export interface ChainEpic {
  id: string;
  /** Moved to a later version by the captain. */
  deferred: boolean;
  stories: ChainStory[];
}

/**
 * Whether Amun may propose "Mark Delivered" (§4.12): every epic of the
 * approved version is Done or deferred, at least one is Done, and its
 * release is Verified live. The captain still confirms.
 */
export function canProposeDelivered(
  epics: ChainEpic[],
  releaseVerifiedLive: boolean,
): boolean {
  if (!releaseVerifiedLive) return false;
  const kept = epics.filter((epic) => !epic.deferred);
  return (
    kept.length > 0 &&
    kept.every((epic) => progressOf(epic.stories).state === "done")
  );
}
