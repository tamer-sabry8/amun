import { outcomeNotes } from "../../../../packages/domain/src/work/home.ts";
import {
  answerRequest,
  changesRequest,
  offerRequest,
  pendingOffers,
} from "./offer-turns.ts";
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

/**
 * The owner asked for changes to a plan. The plan closes, and Firstmate is
 * told once in the work it belongs to, so it can bring back a new proposal.
 */
export function requestPlanChanges(
  plan: { id: string; workAreaId: string | null; summary: string },
  note = "",
  queue = pendingOffers,
) {
  work("request-changes", { planId: plan.id, note });
  if (plan.workAreaId)
    queue.queue({
      id: "changes:" + plan.id,
      areaId: plan.workAreaId,
      text: changesRequest(plan.summary, note),
    });
}

/** The owner picked an answer on a question card; Firstmate hears it once. */
export function answerQuestion(
  question: { id: string; workAreaId: string | null; title: string },
  answer: string,
  queue = pendingOffers,
) {
  work("resolve-attention", {
    attentionId: question.id,
    resolution: "answer",
    answer,
  });
  if (question.workAreaId)
    queue.queue({
      id: "answer:" + question.id,
      areaId: question.workAreaId,
      text: answerRequest(question.title, answer),
    });
}
