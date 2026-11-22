// "Where should this go?": a message that asks for new work inside another
// folder is held until the owner chooses, and Firstmate can suggest moving
// messages that drifted to another subject. The question is asked on
// Firstmate's card; nothing is ever moved or sent without the owner's click
// (owner, 20 November 2026).
import {
  moveQuestionRef,
  isMoveQuestion,
} from "../../../../packages/domain/src/work/home.ts";
import {
  generalConversationName,
  type NewWorkRequest,
} from "../../../../packages/domain/src/work/model.ts";

export { isMoveQuestion };

/** What the card message in the chat holds while the question is open. */
export interface MoveOffer {
  kind: "move-offer";
  state: "open" | "moved" | "kept";
  /** The owner's words, not sent yet; null when the messages were already sent. */
  held: string | null;
  /** A suggestion about sent messages: the first one that would move. */
  fromMessageId: string | null;
  request: NewWorkRequest;
  /** A folder that already has this name, archived ones included. */
  existingAreaId: string | null;
  /** Where the owner typed it. */
  workAreaId: string;
  chatId: string | null;
  /** Where it went, once moved. */
  to?: { workAreaId: string; chatId: string | null; name: string };
}

/** The line a chat keeps where its messages were moved away. */
export interface MovedLine {
  kind: "moved";
  toWorkAreaId: string;
  toChatId: string | null;
  name: string;
}

export const moveRef = (cardMessageId: string) =>
  moveQuestionRef + cardMessageId;
export const moveCardId = (ref: string | null | undefined) =>
  ref?.startsWith(moveQuestionRef) ? ref.slice(moveQuestionRef.length) : null;

export function asMoveOffer(card: unknown): MoveOffer | null {
  const value = card as Partial<MoveOffer> | null;
  return value &&
    typeof value === "object" &&
    value.kind === "move-offer" &&
    typeof value.workAreaId === "string" &&
    typeof value.request?.name === "string"
    ? (value as MoveOffer)
    : null;
}
export function asMovedLine(card: unknown): MovedLine | null {
  const value = card as Partial<MovedLine> | null;
  return value &&
    typeof value === "object" &&
    value.kind === "moved" &&
    typeof value.toWorkAreaId === "string" &&
    typeof value.name === "string"
    ? (value as MovedLine)
    : null;
}

interface CardMessage {
  id: string;
  card: unknown;
}
/** The open offer behind an attention item, wherever its chat is. */
export function findMoveOffer(
  snapshot: {
    messages: readonly CardMessage[];
    chats: readonly { messages: readonly CardMessage[] }[];
  },
  ref: string | null | undefined,
): MoveOffer | null {
  const id = moveCardId(ref);
  if (!id) return null;
  const message =
    snapshot.messages.find((item) => item.id === id) ??
    snapshot.chats
      .flatMap((chat) => chat.messages)
      .find((item) => item.id === id);
  return asMoveOffer(message?.card);
}

export type MoveChoice = "new" | "existing" | "another" | "keep";

export interface MoveQuestion {
  /** The small line under "Firstmate". */
  label: "Question" | "Suggestion";
  title: string;
  detail: string;
  /** The owner can change the new folder's name before moving. */
  nameField: boolean;
  buttons: { choice: MoveChoice; label: string }[];
  note: string;
}

/**
 * The question in plain words. `hereName` is the folder it was typed in, null
 * for a chat that has no folder; `existingName` is the folder that already
 * has the name.
 */
export function moveQuestion(
  offer: MoveOffer,
  hereName: string | null,
  existingName: string | null,
): MoveQuestion {
  const one = offer.held !== null;
  const here =
    hereName && hereName !== generalConversationName ? hereName : null;
  const keep = here
    ? `Keep ${one ? "it" : "them"} in ${here}`
    : `Keep ${one ? "it" : "them"} here`;
  const note = one
    ? "Nothing is sent until you choose"
    : "Nothing moves unless you say so";
  if (existingName)
    return {
      label: one ? "Question" : "Suggestion",
      title: `You already have a folder called ${existingName}`,
      detail: one
        ? "Your message has not been sent yet."
        : `The last messages${here ? ` in ${here}` : ""} are about ${existingName}.`,
      nameField: false,
      buttons: [
        {
          choice: "existing",
          label: one ? `Open ${existingName}` : `Move them to ${existingName}`,
        },
        ...(one
          ? [{ choice: "another" as const, label: "Create another" }]
          : []),
        { choice: "keep", label: keep },
      ],
      note,
    };
  return {
    label: one ? "Question" : "Suggestion",
    title: one
      ? `This looks like a new ${
          offer.request.type === "rfp"
            ? "RFP"
            : offer.request.type === "task"
              ? "Initiative"
              : offer.request.type
        }`
      : "This may belong in its own folder",
    detail: one
      ? `“${offer.request.name}” is not part of ${here ?? "this chat"}. Your message has not been sent yet.`
      : `The last messages${here ? ` in ${here}` : ""} are about ${offer.request.name}.`,
    nameField: true,
    buttons: [
      {
        choice: "new",
        label: one ? "Move to a new folder" : "Move them to a new folder",
      },
      { choice: "keep", label: keep },
    ],
    note,
  };
}

/** A name for "Create another" that no folder has yet. */
export function anotherName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map((item) => item.trim().toLowerCase()));
  for (let number = 2; ; number += 1) {
    const next = `${name} ${number}`;
    if (!used.has(next.toLowerCase())) return next;
  }
}

// A message the owner has decided about is sent as it is, once, without being
// asked about again. What settles its question runs only after the message is
// saved in the chat it goes to: if Amun closes before that, the question is
// still open and the owner's words are still on its card.
const decided = new Map<string, () => void>();
export const sendAsTyped = (text: string, onSaved: () => void = () => {}) =>
  void decided.set(text.trim(), onSaved);
/** Null when the message was not decided about; otherwise what to run once it is saved. */
export function takeAsTyped(text: string): (() => void) | null {
  const key = text.trim();
  const onSaved = decided.get(key) ?? null;
  decided.delete(key);
  return onSaved;
}
