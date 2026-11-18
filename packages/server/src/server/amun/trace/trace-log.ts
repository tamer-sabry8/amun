import { appendFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { Redactor } from "@amun/work-store";

/** Days of Amun trace kept on disk; older day files are deleted on start. */
export const TRACE_KEEP_DAYS = 14;

export interface TraceEvent {
  /** Which part of the system spoke: amun-rpc, chat, connection, first-mate. */
  source: string;
  kind: string;
  [key: string]: unknown;
}

export interface TraceLogOptions {
  dir: string;
  redactor?: Redactor;
  now?: () => Date;
}

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Amun's own trace: one JSON line per event in `<dir>/<YYYY-MM-DD>.jsonl`.
 * Every event passes the redactor first, so no secret reaches the disk.
 * Writing never throws: a full disk must not break the captain's chat.
 */
export class TraceLog {
  readonly dir: string;
  private readonly redactor: Redactor;
  private readonly now: () => Date;

  constructor(options: TraceLogOptions) {
    this.dir = options.dir;
    this.redactor = options.redactor ?? new Redactor();
    this.now = options.now ?? (() => new Date());
    mkdirSync(this.dir, { recursive: true });
    this.prune();
  }

  record(event: TraceEvent): void {
    const at = this.now();
    const line = JSON.stringify(this.redactor.clean({ at: at.toISOString(), ...event }));
    try {
      appendFileSync(path.join(this.dir, `${dayOf(at)}.jsonl`), line + "\n", { mode: 0o600 });
    } catch {
      // Tracing is best effort by design.
    }
  }

  /** Day files, oldest first. */
  files(): string[] {
    return readdirSync(this.dir)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
      .sort();
  }

  private prune(): void {
    const cutoff = dayOf(new Date(this.now().getTime() - TRACE_KEEP_DAYS * 86_400_000));
    for (const name of this.files())
      if (name.slice(0, 10) < cutoff) rmSync(path.join(this.dir, name), { force: true });
  }
}
