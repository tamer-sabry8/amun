// Asks the daemon for the trace bundle and saves it as a zip. Used by
// Settings → Advanced → Diagnostics and the right rail's download button.
import {
  traceBundle,
  traceBundleFailed,
  type TraceBundle,
} from "@amun/contracts";
import { bridge } from "../bridge.ts";

const WAIT_MS = 120_000;

export class TraceExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TraceExportError";
  }
}

/** Builds the bundle in the daemon; resolves when it arrives. */
export function requestTrace(): Promise<TraceBundle> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new TraceExportError("Amun took too long to build the trace."));
    }, WAIT_MS);
    const off = bridge.onEvent((value) => {
      const ready = traceBundle.safeParse(value);
      const failed = traceBundleFailed.safeParse(value);
      if (ready.success && ready.data.id === id) {
        clearTimeout(timer);
        off();
        resolve(ready.data);
      } else if (failed.success && failed.data.id === id) {
        clearTimeout(timer);
        off();
        reject(new TraceExportError(failed.data.message));
      }
    });
    bridge.send({ version: 1, kind: "diagnostics", id });
  });
}

/** Saves the zip through the browser's own download, so no new file access. */
export function saveTrace(bundle: TraceBundle): void {
  const bytes = Uint8Array.from(atob(bundle.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/zip" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = bundle.fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function traceSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const HISTORY_NOTE: Record<TraceBundle["history"], string | null> = {
  on: null,
  asked:
    "Agent history is off, so retired agents are missing. Amun asked the First Mate to turn it on.",
  off: "Agent history is off, so retired agents are missing.",
};
