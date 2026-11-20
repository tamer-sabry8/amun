// What a Portfolio card says about one product or project, and the order
// the cards come in (owner, 20 November 2026): the ones at risk first, then
// the nearest dates.

export interface PortfolioWork {
  id: string;
  type: string;
  status: string;
  dueAt: string | null;
  lastContextAt: string | null;
  createdAt: string;
}

/**
 * How far along the work is, when Amun knows. It comes from the tracker the
 * work is linked to; without that link there is nothing to show.
 */
export interface WorkProgress {
  /** 0 to 100. */
  donePercent: number;
  /** For example "19 in development, 24 to do, 11 in QA testing". */
  line: string;
}

const day = 86_400_000;
const finished = new Set(["done", "closed", "delivered", "archived"]);
/** A date this close counts as near when the work is not known to be on track. */
const nearDays = 14;

export interface PortfolioCard {
  /** Whole days until the date; negative once it has passed; null without one. */
  daysLeft: number | null;
  /** "14" on the card, or "—" when there is no date. */
  daysText: string;
  daysLabel: string;
  atRisk: boolean;
  /** One line under the figures. */
  line: string;
}

export function portfolioCard(
  work: PortfolioWork,
  now: number,
  progress: WorkProgress | null = null,
): PortfolioCard {
  const open = !finished.has(work.status.toLowerCase());
  const daysLeft =
    work.dueAt === null
      ? null
      : Math.ceil((Date.parse(work.dueAt) - now) / day);
  const overdue = daysLeft !== null && daysLeft < 0;
  // Near its date with most of the work open, or past its date.
  const atRisk =
    open &&
    daysLeft !== null &&
    (overdue ||
      (daysLeft <= nearDays &&
        (progress === null || progress.donePercent < 80)));
  const dueLine =
    daysLeft === null
      ? null
      : overdue
        ? `${-daysLeft} ${daysLeft === -1 ? "day" : "days"} past its date`
        : daysLeft === 0
          ? "Due today"
          : `Due in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`;
  const line = !open
    ? "Finished"
    : atRisk && progress
      ? `${dueLine} · ${100 - progress.donePercent}% of the work not done`
      : (progress?.line ?? dueLine ?? "No date set");
  return {
    daysLeft,
    daysText: daysLeft === null ? "—" : String(overdue ? -daysLeft : daysLeft),
    daysLabel: overdue
      ? "days late"
      : daysLeft === 1
        ? "day left"
        : "days left",
    atRisk,
    line,
  };
}

/** At risk first, then the nearest date, then the most recently used. */
export function portfolioOrder<T extends PortfolioWork>(
  works: readonly T[],
  now: number,
  progress: (work: T) => WorkProgress | null = () => null,
): T[] {
  const far = Number.MAX_SAFE_INTEGER;
  return [...works]
    .map((work) => ({ work, card: portfolioCard(work, now, progress(work)) }))
    .sort(
      (a, b) =>
        Number(b.card.atRisk) - Number(a.card.atRisk) ||
        (a.card.daysLeft ?? far) - (b.card.daysLeft ?? far) ||
        (b.work.lastContextAt ?? b.work.createdAt).localeCompare(
          a.work.lastContextAt ?? a.work.createdAt,
        ),
    )
    .map((item) => item.work);
}
