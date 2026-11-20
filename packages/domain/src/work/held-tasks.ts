// Firstmate's own reminders ("captain holds") as they are shown on Home
// (owner, 20 November 2026). A hold filed under a project ("MoCA: …") is a
// task of that project with a tick box; any other is a reminder. Every
// choice is a request to Firstmate, which owns the hold; Amun closes nothing.
import { sameWorkName } from "./model.ts";

/** Attention ids for Firstmate's holds start with this. */
export const heldPrefix = "hold:";
export const isHeld = (id: string) => id.startsWith(heldPrefix);

/**
 * The project or product a hold belongs to, read from its title ("MoCA: …",
 * "MoCA - …"): a work whose name is the same, or starts with that word.
 */
export function heldProject(
  title: string,
  areas: readonly { name: string; type: string; status: string }[],
): string | null {
  const lead = /^\s*([^:–-]{2,60}?)\s*(?::|\s[–-]\s)/.exec(title)?.[1]?.trim();
  if (!lead) return null;
  const word = (name: string) => name.trim().split(/\s+/)[0] ?? "";
  const match = areas.find(
    (area) =>
      area.status !== "deleted" &&
      (area.type === "project" || area.type === "product") &&
      (sameWorkName(area.name, lead) || sameWorkName(word(area.name), lead)),
  );
  return match ? lead : null;
}

/** How long a ticked task stays in the open list before it goes to Done. */
export const tickedVisibleMs = 20_000;
/** How long Undo is offered before the request goes to Firstmate. */
export const tickUndoMs = 5_000;

/** "Remind me later": the days offered, as YYYY-MM-DD on the owner's calendar. */
export function laterDays(now: Date): { label: string; day: string }[] {
  const day = (date: Date) => {
    const two = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  };
  const plus = (days: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  // Next Monday is never today: from a Monday it is a week on.
  const toMonday = (8 - now.getDay()) % 7 || 7;
  return [
    { label: "Tomorrow morning", day: day(plus(1)) },
    { label: "Next Monday", day: day(plus(toMonday)) },
    { label: "In two weeks", day: day(plus(14)) },
  ];
}

/** What the owner sees in Done for a hold they closed or put off. */
export function heldOutcome(
  resolution: "done" | "snooze",
  until?: string,
): string {
  return resolution === "done"
    ? "Completed"
    : `Remind me on ${until ?? "a later day"}`;
}

/**
 * What Firstmate is told, as the owner's answer to its hold. Firstmate
 * decides how to record it with its own scripts.
 */
export function heldInstruction(
  resolution: "done" | "snooze",
  until?: string,
): string {
  return resolution === "done"
    ? "Completed. The captain says this is done and no longer needed. Record that and close the task; do not ask about it again."
    : `Not now. Remind the captain on ${until}. Keep it held and put it off until that day (bin/fm-captain-hold.sh hold with --until ${until}); do not raise it again before then.`;
}

/**
 * "Help me do it": the request sent to Firstmate in the owner's latest chat.
 * The owner's standing wish (20 November 2026): a reminder to write
 * something comes with a draft, or with questions when context is missing.
 */
export function helpRequest(title: string): string {
  return (
    `Help me do it: ${title}\n` +
    "Give it to the agent whose job it is. If you have what you need, have them draft it here for me to edit. " +
    "If not, interview me one question at a time first. Nothing is sent to anyone, and the reminder stays open until I mark it done."
  );
}

/** Sent once per home, so Firstmate files the owner's rule itself. */
export const draftingRule =
  "The captain asks, in their own words: “When you remind me about something I have to write, such as an email, draft it or ask me to draft it, or interview me if you have no context to understand and draft it.” File this as a standing rule where it belongs, and follow it from now on.";
