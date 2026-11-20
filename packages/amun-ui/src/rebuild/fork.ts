// Forks: a second chat inside a piece of work, started from one message.
// Firstmate has one memory for every chat, so nothing is rewound; each
// message sent from a fork says which chat it is and what to set aside.

export interface ForkChat {
  id: string;
  title: string;
  fromChatId: string | null;
  createdAt: string;
  messages: { role: string; text: string; createdAt: string }[];
}

/** When the message the fork was taken from was written. */
export function forkPoint(chat: ForkChat): string | null {
  return (
    chat.messages.findLast((message) => message.createdAt <= chat.createdAt)
      ?.createdAt ?? null
  );
}

/**
 * The line Firstmate reads before the owner's words in a fork. The first
 * message of a fork explains it in full; later ones only name the chat.
 */
export function forkNote(chat: ForkChat, messages: ForkChat["messages"]) {
  const started = messages.some(
    (message) => message.role === "you" && message.createdAt > chat.createdAt,
  );
  if (started) return `[Fork “${chat.title}” of this work area.]`;
  return (
    `[This is a fork of this work area's ${chat.fromChatId ? "other" : "main"} chat, taken from the message “${chat.title}”. ` +
    "The owner is trying a different direction here. For this chat, set aside anything the owner or you said in the other chat after that message, and do not mix the two. " +
    "Work already handed to the crew is not undone; stop it only if the owner asks.]"
  );
}

/**
 * The line Firstmate reads before the owner's words in a chat the owner
 * started ("New chat"). Firstmate has one memory for every chat, so the first
 * message says this is a fresh topic and names the folder's other chats;
 * later ones only name the chat (owner, 19 November 2026).
 */
export function chatNote(
  title: string,
  started: boolean,
  otherChats: readonly string[],
) {
  if (started) return `[Chat “${title}” of this work area.]`;
  const others = otherChats.length
    ? ` This work area's other chats are: ${otherChats
        .slice(0, 12)
        .map((name) => `“${name}”`)
        .join(", ")}.`
    : "";
  return (
    "[This is a new chat in this work area, on a fresh topic. Use the work area's own record below." +
    others +
    " Do not bring in anything said in the other chats unless the owner brings it up, and do not mix this chat with them.]"
  );
}

/**
 * A short recap of a chat for a Firstmate whose memory has started fresh. It
 * travels with the owner's next message and is never shown (owner, 19
 * November 2026). Empty for a chat with nothing said yet.
 */
export function chatRecap(
  messages: readonly { role: string; text: string }[],
): string {
  const said = messages.filter(
    (message) => message.role === "you" || message.role === "firstmate",
  );
  if (!said.length) return "";
  const short = (text: string) => {
    const line = text.replace(/\s+/g, " ").trim();
    return line.length > 400 ? line.slice(0, 400).trimEnd() + "…" : line;
  };
  const lines = said
    .slice(-8)
    .map(
      (message) =>
        `${message.role === "you" ? "Owner" : "You"}: ${short(message.text)}`,
    );
  return (
    "[Recap of this chat so far, because your memory has started fresh. " +
    (said.length > lines.length
      ? `These are the last ${lines.length} of ${said.length} messages.`
      : "This is all of it.") +
    " Carry on from here without mentioning the recap.]\n" +
    lines.join("\n") +
    "\n[End of recap.]\n"
  );
}
