export type ScrollTarget = "latest-reply" | "end" | "none";

type Line = { role: string };

/**
 * Where the conversation should scroll after it changes.
 * `prevCount` is null the first time a conversation is shown.
 * A new Firstmate reply is shown from its start, because the cards below it
 * can push it out of view; otherwise the bottom is kept, which holds the
 * owner's message and the working indicator.
 */
export function scrollTarget(
  prevCount: number | null,
  messages: readonly Line[],
  busy: boolean,
): ScrollTarget {
  const fresh = messages.slice(prevCount ?? Math.max(0, messages.length - 1));
  if (fresh.some((message) => message.role === "firstmate"))
    return "latest-reply";
  if (prevCount === null) return "end";
  if (messages.length > prevCount || busy) return "end";
  return "none";
}
