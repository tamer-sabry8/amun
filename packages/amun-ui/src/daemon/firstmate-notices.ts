// Carries the owner's on-screen actions to Firstmate, in the background.
//
// Notes made close together travel as one prompt, so a run of clicks is one
// turn for Firstmate, not many. A note is kept until Firstmate has taken it:
// if Firstmate cannot be reached it is tried again, and it survives Amun
// closing when the window offers storage.
import {
  isNoted,
  noticePrompt,
  type FirstmateNotice,
} from "../../../domain/src/work/firstmate-notice.ts";

export interface NoticeKeep {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface NoticeOptions {
  /** How long to wait for more notes before sending. */
  delayMs?: number;
  /** First wait after a failed send; doubles up to five minutes. */
  retryMs?: number;
  /** Most notes in one prompt. */
  batch?: number;
  keep?: NoticeKeep | null;
}

const KEY = "amun.firstmate-notices.v1";
const MAX_WAITING = 200;

function windowKeep(): NoticeKeep | null {
  try {
    const store = (globalThis as { localStorage?: NoticeKeep }).localStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

export class NoticeQueue {
  private waiting: FirstmateNotice[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending = false;
  private failures = 0;
  private readonly delayMs: number;
  private readonly retryMs: number;
  private readonly batch: number;
  private readonly keep: NoticeKeep | null;

  constructor(
    /** Sends one prompt to Firstmate and resolves with its reply. */
    private readonly send: (text: string) => Promise<string>,
    /** Called with a reply that says more than "Noted." */
    private readonly onReply: (
      reply: string,
      notices: FirstmateNotice[],
    ) => Promise<void> | void,
    options: NoticeOptions = {},
  ) {
    this.delayMs = options.delayMs ?? 1500;
    this.retryMs = options.retryMs ?? 30_000;
    this.batch = options.batch ?? 8;
    this.keep = options.keep === undefined ? windowKeep() : options.keep;
    try {
      const saved = JSON.parse(this.keep?.getItem(KEY) ?? "[]") as unknown;
      if (Array.isArray(saved))
        this.waiting = saved.filter(
          (note): note is FirstmateNotice =>
            !!note &&
            typeof (note as FirstmateNotice).what === "string" &&
            Array.isArray((note as FirstmateNotice).card),
        );
    } catch {
      this.waiting = [];
    }
    if (this.waiting.length) this.schedule(this.delayMs);
  }

  /** Notes not yet taken by Firstmate. */
  get pending(): number {
    return this.waiting.length;
  }

  add(notice: FirstmateNotice): void {
    this.waiting.push(notice);
    // Never grow without end while Firstmate is away; the oldest go first.
    if (this.waiting.length > MAX_WAITING)
      this.waiting.splice(0, this.waiting.length - MAX_WAITING);
    this.save();
    if (!this.sending) this.schedule(this.delayMs);
  }

  /** Try again now, for example once the daemon is back. */
  resume(): void {
    if (this.waiting.length && !this.sending) this.schedule(0);
  }

  private save(): void {
    try {
      this.keep?.setItem(KEY, JSON.stringify(this.waiting));
    } catch {
      // Storage full or unavailable: the notes stay in memory.
    }
  }

  private schedule(wait: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, wait);
    // Never keep a process alive only to deliver a note.
    (this.timer as { unref?: () => void }).unref?.();
  }

  private async flush(): Promise<void> {
    if (this.sending || !this.waiting.length) return;
    this.sending = true;
    const batch = this.waiting.slice(0, this.batch);
    let reply: string | null = null;
    try {
      reply = await this.send(noticePrompt(batch));
      // Taken: only now do the notes leave the list.
      this.waiting.splice(0, batch.length);
      this.failures = 0;
      this.save();
    } catch {
      this.failures += 1;
    }
    this.sending = false;
    if (reply !== null && !isNoted(reply)) {
      try {
        await this.onReply(reply.trim(), batch);
      } catch {
        // The reply could not be filed; the note itself was delivered.
      }
    }
    if (this.waiting.length)
      this.schedule(
        this.failures
          ? Math.min(this.retryMs * 2 ** (this.failures - 1), 300_000)
          : 0,
      );
  }
}
