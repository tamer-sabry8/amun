// Reading a chat (owner's chat handoff, 20 November 2026). Opening a chat with
// unread replies lands on the first of them under a "New replies" divider;
// otherwise it returns to where the owner stopped, or opens at a passage
// chosen in search. Replies are marked read as they come into view. At the
// bottom, new content is followed; scrolled up, the passage stays put and
// "New reply ↓" appears.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { work } from "./store.ts";
import { chatMemory, setLast, setSpot } from "./chat-memory.ts";

interface Line {
  id: string;
  role: string;
  readAt?: string | null | undefined;
}
/**
 * Where to open: a message chosen in search or "Open reply", or (resume)
 * where the owner stopped, from Home's Continue.
 */
export type ReadingFocus =
  | {
      messageId: string;
      /** Briefly highlight it (a search hit). */
      flash?: boolean;
    }
  | { resume: true };

const nearBottom = 48;
const reads = new Set<string>();
let readTimer: ReturnType<typeof setTimeout> | null = null;
function markRead(id: string) {
  reads.add(id);
  if (readTimer) return;
  readTimer = setTimeout(() => {
    readTimer = null;
    const ids = [...reads].slice(0, 500);
    for (const item of ids) reads.delete(item);
    if (ids.length) work("read-messages", { messageIds: ids });
  }, 400);
}
/**
 * Scrolls only the conversation, never the window around it (scrollIntoView
 * would move every scrolling ancestor, the app frame included).
 */
function reveal(
  container: HTMLElement,
  target: HTMLElement,
  block: "start" | "center",
) {
  const offset =
    target.getBoundingClientRect().top - container.getBoundingClientRect().top;
  const room =
    block === "center"
      ? (container.clientHeight - target.offsetHeight) / 2
      : 12;
  container.scrollTop += offset - Math.max(room, 0);
}
const atBottom = (element: HTMLElement) =>
  element.scrollHeight - element.scrollTop - element.clientHeight < nearBottom;

export function useReading({
  chatKey,
  messages,
  thread,
  focus,
}: {
  chatKey: string;
  messages: readonly Line[];
  thread: React.RefObject<HTMLElement | null>;
  focus: ReadingFocus | null;
}) {
  // The divider sits where the unread replies began when the chat opened,
  // and stays there for the visit even as they are read.
  const [divider, setDivider] = useState<string | null>(null);
  const [newBelow, setNewBelow] = useState(false);
  const [missing, setMissing] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const count = useRef<number | null>(null);
  const following = useRef(true);

  useEffect(() => setLast(chatKey), [chatKey]);

  // Where the chat opens.
  useLayoutEffect(() => {
    const element = thread.current;
    count.current = messages.length;
    const firstUnread =
      messages.find(
        (message) => message.role === "firstmate" && message.readAt === null,
      )?.id ?? null;
    setDivider(firstUnread);
    setMissing(false);
    if (!element) return;
    const find = (id: string) =>
      element.querySelector<HTMLElement>(`[data-mid="${CSS.escape(id)}"]`);
    const restore = () => {
      const spot = chatMemory().spots[chatKey];
      const anchor = spot ? find(spot.messageId) : null;
      if (anchor && spot) {
        element.scrollTop +=
          anchor.getBoundingClientRect().top -
          element.getBoundingClientRect().top -
          spot.offset;
        return true;
      }
      element.scrollTop = element.scrollHeight;
      return false;
    };
    if (focus && "resume" in focus) {
      // Home's Continue: back where reading stopped, newer replies below.
      restore();
      if (firstUnread && !atBottom(element)) setNewBelow(true);
    } else if (focus) {
      const target = find(focus.messageId);
      if (target) {
        reveal(element, target, "center");
        if (focus.flash) setFlash(focus.messageId);
      } else {
        // The chat exists, but that passage is gone.
        setMissing(true);
        element.scrollTop = element.scrollHeight;
      }
    } else if (firstUnread && find(firstUnread)) {
      const mark = element.querySelector<HTMLElement>(".rb-new-replies");
      reveal(element, (mark ?? find(firstUnread))!, "start");
    } else restore();
    following.current = atBottom(element);
    // Only on opening; later changes follow the rules below.
  }, [chatKey, focus && ("resume" in focus ? "resume" : focus.messageId)]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 2400);
    return () => clearTimeout(timer);
  }, [flash]);

  // New content: follow it at the bottom, otherwise say it is there.
  useLayoutEffect(() => {
    const element = thread.current;
    const before = count.current;
    count.current = messages.length;
    if (!element || before === null || messages.length <= before) return;
    if (following.current) {
      const fresh = messages
        .slice(before)
        .find((message) => message.role === "firstmate");
      const start = fresh
        ? element.querySelector<HTMLElement>(
            `[data-mid="${CSS.escape(fresh.id)}"]`,
          )
        : null;
      // A long reply is shown from its start; anything else at the end.
      if (start && start.offsetHeight > element.clientHeight * 0.8)
        reveal(element, start, "start");
      else element.scrollTop = element.scrollHeight;
    } else if (messages.slice(before).some((message) => message.role !== "you"))
      setNewBelow(true);
    else element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  // Scrolling: remember the spot, follow the bottom again when reached.
  useEffect(() => {
    const element = thread.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      const top = element.getBoundingClientRect().top;
      const anchor = [
        ...element.querySelectorAll<HTMLElement>("[data-mid]"),
      ].find((item) => item.getBoundingClientRect().bottom > top + 4);
      if (!anchor) return;
      setSpot(chatKey, {
        messageId: anchor.dataset.mid!,
        offset: anchor.getBoundingClientRect().top - top,
      });
    };
    const scrolled = () => {
      following.current = atBottom(element);
      if (following.current) setNewBelow(false);
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, 300);
    };
    element.addEventListener("scroll", scrolled, { passive: true });
    return () => {
      element.removeEventListener("scroll", scrolled);
      if (timer) clearTimeout(timer);
      save();
    };
  }, [chatKey]);

  // Unread replies count as read once mostly in view, while Amun is in front.
  useEffect(() => {
    const element = thread.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (document.visibilityState !== "visible") return;
        for (const entry of entries)
          if (entry.isIntersecting) {
            const id = (entry.target as HTMLElement).dataset.mid;
            if (id) markRead(id);
            observer.unobserve(entry.target);
          }
      },
      { root: element, threshold: 0.6 },
    );
    for (const item of element.querySelectorAll<HTMLElement>(
      '[data-unread="true"]',
    ))
      observer.observe(item);
    return () => observer.disconnect();
  }, [
    chatKey,
    messages.length,
    messages.filter((m) => m.readAt === null).length,
  ]);

  return {
    divider,
    newBelow,
    missing,
    flash,
    jumpDown() {
      const element = thread.current;
      if (!element) return;
      element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
      setNewBelow(false);
    },
    dismissMissing: () => setMissing(false),
    /** Scrolls to one message and highlights it briefly. */
    show(messageId: string) {
      const element = thread.current;
      const target = element?.querySelector<HTMLElement>(
        `[data-mid="${CSS.escape(messageId)}"]`,
      );
      if (!element || !target) return false;
      reveal(element, target, "center");
      setFlash(messageId);
      return true;
    },
    /** True while the view is at the bottom, following new content. */
    following: () => following.current,
  };
}
