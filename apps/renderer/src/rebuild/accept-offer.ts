import { outcomeNotes } from "../../../../packages/domain/src/work/home.ts";
import { offerRequest, pendingOffers } from "./offer-turns.ts";
import { work } from "./store.ts";

/**
 * The owner said yes to an offer, from Home or the Island. The offer closes,
 * and Firstmate is asked to draft it in the work it belongs to; the work's
 * conversation sends that request. Repeating it changes nothing.
 */
export function acceptOffer(
  item: {
    id: string;
    state: string;
    workAreaId: string | null;
    title: string;
    detail: string;
  },
  queue = pendingOffers,
) {
  if (item.state !== "open") return { note: outcomeNotes.draft, areaId: null };
  work("resolve-attention", { attentionId: item.id, resolution: "accept" });
  if (!item.workAreaId)
    return {
      note: "Marked as wanted. It belongs to no work yet, so nothing is being drafted. Open the work and ask for it there.",
      areaId: null,
    };
  queue.queue({
    id: item.id,
    areaId: item.workAreaId,
    text: offerRequest(item.title, item.detail),
  });
  return { note: outcomeNotes.draft, areaId: item.workAreaId };
}
