// The request reference saved with the owner's message (owner, 20 November
// 2026). It is the only link between a later report or delivery and the
// message that asked for it.
import { isRequestRef } from "../../../../packages/domain/src/work/requests.ts";

/** The reference kept on the owner's message, if it has one. */
export function requestRefOf(card: unknown): string | null {
  if (!card || typeof card !== "object") return null;
  const ref = (card as { ref?: unknown }).ref;
  return isRequestRef(ref) ? ref : null;
}
