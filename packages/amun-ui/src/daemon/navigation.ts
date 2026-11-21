import { newRequestRef } from "../../../domain/src/work/requests.ts";
import type { NoticeKeep } from "./firstmate-notices.ts";

export interface Inspection {
  view: string;
  areaId?: string;
  project?: string;
  record?: string;
  source?: string;
  search?: { query: string; details: boolean; backlog: string };
}
interface Pending {
  ref: string;
  inspection: Inspection;
  prompt: string;
  delivered: boolean;
}
type ActivityState = "running" | "finished";
type Delivery = {
  activity(item: Pending, state: ActivityState): Promise<void>;
  send(text: string): Promise<void>;
};
const storageKey = "amun.navigation.v1";
let recordInspection: ((target: Inspection) => void) | undefined;

export function inspectView(target: Inspection) {
  recordInspection?.(target);
}

export class NavigationQueue {
  private pending: Pending[];
  private sending = false;
  private retry?: ReturnType<typeof setTimeout>;
  constructor(
    private delivery: Delivery,
    private storage?: NoticeKeep,
  ) {
    this.pending = [];
    try {
      const saved: unknown = JSON.parse(storage?.getItem(storageKey) ?? "[]");
      if (Array.isArray(saved))
        this.pending = saved.filter(
          (n): n is Pending =>
            n &&
            /^amun-r-[0-9a-f]{12}$/.test(n.ref) &&
            typeof n.inspection?.view === "string" &&
            typeof n.prompt === "string",
        );
    } catch {
      /* A damaged cache cannot supply a previous click. */
    }
  }
  install() {
    recordInspection = (target) => this.add(target);
  }
  add(inspection: Inspection) {
    const ref = newRequestRef();
    const location = inspection.project ? ` for ${inspection.project}` : "";
    const instruction = inspection.search
      ? "Search " +
        inspection.search.backlog +
        " for " +
        JSON.stringify(inspection.search.query) +
        " in " +
        (inspection.search.details
          ? "ID, title, description and acceptance criteria"
          : "ID and title") +
        "."
      : "Open " + inspection.view + location + ". Show the selected view.";
    const prompt =
      instruction +
      "\nThis is a read-only inspection. Make no changes. Reply only with an acknowledgement.\nRequest " +
      ref +
      "\nSelection data: " +
      JSON.stringify(inspection);
    this.pending.push({ ref, inspection, prompt, delivered: false });
    this.save();
    void this.flush();
  }
  private save() {
    try {
      this.storage?.setItem(storageKey, JSON.stringify(this.pending));
    } catch {
      /* Keep the in-memory queue. */
    }
  }
  async flush() {
    if (this.sending) return;
    this.sending = true;
    clearTimeout(this.retry);
    try {
      while (this.pending.length) {
        const item = this.pending[0]!;
        if (!item.delivered) {
          await this.delivery.activity(item, "running");
          await this.delivery.send(item.prompt);
          item.delivered = true;
          this.save();
        }
        await this.delivery.activity(item, "finished");
        this.pending.shift();
        this.save();
      }
    } catch {
      this.retry = setTimeout(() => void this.flush(), 30_000);
      (this.retry as { unref?: () => void }).unref?.();
    } finally {
      this.sending = false;
    }
  }
}
