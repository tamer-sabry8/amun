// Where "Ask Firstmate to unblock it" goes (Idea to Done §4.9, option A,
// approved 23 November 2026): the chat of the request the crewmate is
// blocked on, found by its Amun request reference. With none, General.
import type { WorkSnapshot } from "../../../contracts/src/work.ts";
import { unblockRequest } from "../../../domain/src/work/delivery-chain.ts";

export interface UnblockPlace {
  areaId: string;
  chatId: string | null;
  /** "Mira › Create a new Product…", for the button's note. */
  label: string;
}

export function unblockPlace(
  snapshot: Pick<
    WorkSnapshot,
    "agents" | "requests" | "messages" | "chats" | "areas"
  >,
  agentId: string,
): UnblockPlace | null {
  const agent = snapshot.agents.find((item) => item.id === agentId);
  if (!agent) return null;
  const ref = unblockRequest(agent, snapshot.requests);
  const request = ref
    ? snapshot.requests.find((item) => item.ref === ref)
    : undefined;
  if (!request) return null;
  const chat = snapshot.chats.find((item) =>
    item.messages.some((message) => message.id === request.messageId),
  );
  const loose = chat
    ? null
    : snapshot.messages.find((message) => message.id === request.messageId);
  const areaId = chat?.workAreaId ?? loose?.workAreaId;
  if (!areaId) return null;
  const area = snapshot.areas.find((item) => item.id === areaId);
  if (!area) return null;
  const short = (text: string) =>
    text.length > 28 ? `${text.slice(0, 27).trimEnd()}…` : text;
  return {
    areaId,
    chatId: chat?.id ?? null,
    label: [short(area.name), chat ? short(chat.title) : null]
      .filter(Boolean)
      .join(" › "),
  };
}
