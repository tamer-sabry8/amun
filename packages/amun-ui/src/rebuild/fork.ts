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
