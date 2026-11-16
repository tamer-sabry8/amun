// Blockers: who owns unblocking each one and how long it has been waiting (UC32).

export interface Blocker {
  id: string;
  workAreaId: string;
  title: string;
  owner: string | null;
  raisedAt: string;
  resolvedAt: string | null;
}

const day = 86_400_000;

/** "raised today", "raised yesterday", "raised 3 days ago". */
export function raisedAgo(raisedAt: string, now: number) {
  const then = Date.parse(raisedAt);
  const days = Number.isFinite(then)
    ? Math.max(0, Math.floor((now - then) / day))
    : 0;
  return days === 0
    ? "raised today"
    : days === 1
      ? "raised yesterday"
      : `raised ${days} days ago`;
}

/** The muted line under a blocker: "Owner · raised N days ago". */
export function blockerLine(
  blocker: Pick<Blocker, "owner" | "raisedAt">,
  now: number,
) {
  return `${blocker.owner?.trim() || "No owner yet"} · ${raisedAgo(blocker.raisedAt, now)}`;
}

export const openBlockers = (blockers: Blocker[], areaId?: string) =>
  blockers
    .filter(
      (item) =>
        item.resolvedAt === null && (!areaId || item.workAreaId === areaId),
    )
    .sort(
      (a, b) =>
        a.raisedAt.localeCompare(b.raisedAt) || a.id.localeCompare(b.id),
    );

/**
 * The open blocker a message names: an exact title first, then a title that
 * contains the words, or words that contain the title. Null when none or
 * several fit, so a vague name never changes the wrong one.
 */
export function findBlocker(blockers: Blocker[], name: string) {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  const exact = blockers.filter((item) => item.title.toLowerCase() === wanted);
  if (exact.length === 1) return exact[0]!;
  const near = blockers.filter((item) => {
    const title = item.title.toLowerCase();
    return title.includes(wanted) || wanted.includes(title);
  });
  return near.length === 1 ? near[0]! : null;
}

/** What a stakeholder update says about blockers, one line each. */
export function blockerUpdateLines(blockers: Blocker[], now: number) {
  return blockers.map(
    (item) => `Blocked: ${item.title} (${blockerLine(item, now)})`,
  );
}
