// Saves a "where should this go?" question: the card that keeps the owner's
// words in the chat they were typed in, and the item Firstmate's card shows.
import { workAsync } from "./store.ts";
import { moveRef, type MoveOffer, type MoveQuestion } from "./move-offers.ts";

/** A calendar day as the owner's Mac has it, YYYY-MM-DD. */
export function localDay(now: number): string {
  const date = new Date(now);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/**
 * True once both are saved. When the card cannot be saved nothing is asked,
 * and the caller sends the message where it was typed instead.
 */
export async function askWhereItGoes(
  offer: MoveOffer,
  question: MoveQuestion,
  groupId: string | null,
): Promise<boolean> {
  const card = await workAsync("message", {
    workAreaId: offer.workAreaId,
    chatId: offer.chatId,
    role: "card",
    text: offer.held ?? "",
    card: offer as never,
  });
  if (!card.ok || !card.ref) return false;
  const asked = await workAsync("attention", {
    attentionKind: "question",
    groupId,
    workAreaId: offer.workAreaId,
    title: question.title,
    detail: question.detail,
    ref: moveRef(card.ref),
  });
  if (!asked.ok)
    // Without the question the card would hold the message for ever.
    await workAsync("settle-card", {
      messageId: card.ref,
      card: { ...offer, state: "kept" } as never,
    });
  return asked.ok;
}
