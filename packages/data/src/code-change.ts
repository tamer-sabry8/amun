import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { bindAction } from "../../domain/src/governance.ts";
import { ActionStore, type StoredAction } from "./outbox.ts";

export interface CodeChangePayload {
  repo: { owner: string; name: string; url: string };
  base: string;
  branch: string;
  message: string;
  title: string;
  /** The pull request description Amun sends, without its hidden marker. */
  body?: string;
  files: {
    path: string;
    status: "added" | "changed" | "removed" | "renamed";
    additions: number;
    deletions: number;
  }[];
  diffHash: string;
  job: string;
  workAreaId: string;
}
export interface CodeChangeRevisions {
  product: string;
  baseSha: string;
  diffHash: string;
}
export interface CodeChangeProgress {
  commit?: string;
  pushed?: boolean;
}
export interface CodeChangeReceipt {
  repo: string;
  branch: string;
  commit: string;
  number: number;
  url: string;
}
export const hashDiff = (diff: string) =>
  createHash("sha256").update(diff).digest("hex");

const setting = (id: string) => "codechange." + id;
/** A pull request opened by Amun carries this marker so it can be found again. */
export const pullMarker = (id: string) => `<!-- amun-code-change:${id} -->`;

/**
 * The owner's review of a crewmate's code change. The approval binds the
 * repository, base branch, new branch, message and the hash of the exact diff.
 */
export class CodeChangeReview {
  readonly store: ActionStore;
  constructor(private readonly db: Database.Database) {
    this.store = new ActionStore(db);
  }
  private put(key: string, value: unknown) {
    this.db
      .prepare(
        "INSERT INTO workspace_settings(id,value_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json",
      )
      .run(setting(key), JSON.stringify(value));
  }
  private get<T>(key: string): T | undefined {
    const row = this.db
      .prepare("SELECT value_json FROM workspace_settings WHERE id=?")
      .get(setting(key)) as { value_json: string } | undefined;
    return row ? (JSON.parse(row.value_json) as T) : undefined;
  }
  /** Raises the review. The diff is kept beside it and checked against its hash. */
  propose(
    product: string,
    payload: CodeChangePayload,
    baseSha: string,
    diff: string,
  ) {
    if (hashDiff(diff) !== payload.diffHash)
      throw Error("The change does not match its hash.");
    if (!payload.branch.startsWith("amun/") || payload.branch === payload.base)
      throw Error("Amun only opens its own branches.");
    const id = randomUUID();
    const revisions: CodeChangeRevisions = {
      product,
      baseSha,
      diffHash: payload.diffHash,
    };
    this.db
      .transaction(() => {
        this.store.propose({
          id,
          productId: product,
          kind: "code_change",
          payload,
          revisions,
          requestedBy: "firstmate",
          operationMarker: pullMarker(id),
        });
        this.put("diff." + id, diff);
      })
      .immediate();
    return { id, binding: bindAction("code_change", payload, revisions) };
  }
  read(id: string) {
    const action = this.store.read(id);
    if (action.kind !== "code_change") throw Error("Not a code change.");
    const payload = action.payload as CodeChangePayload;
    const revisions = action.revisions as CodeChangeRevisions;
    const diff = this.get<string>("diff." + id) ?? "";
    return {
      action,
      payload,
      revisions,
      diff,
      diffIntact: hashDiff(diff) === payload.diffHash,
      binding: bindAction("code_change", payload, revisions),
      progress: this.get<CodeChangeProgress>("progress." + id) ?? {},
      receipt: this.get<CodeChangeReceipt>("receipt." + id),
    };
  }
  /**
   * Reviews for one product, newest first. `areas` are the product's work
   * areas: a change made for one of them belongs here even when it was filed
   * while another product was selected.
   */
  list(product: string, limit = 20, areas: readonly string[] = []) {
    const rows = this.db
      .prepare(
        "SELECT id FROM actions WHERE kind='code_change' ORDER BY rowid DESC LIMIT 200",
      )
      .all() as { id: string }[];
    return rows
      .map((row) => this.read(row.id))
      .filter(
        (item) =>
          item.revisions.product === product ||
          areas.includes(item.payload.workAreaId),
      )
      .slice(0, limit);
  }
  /**
   * Approves one exact version. `current` is the hash of what is in the
   * worktree right now: if it moved, the owner must review it again.
   */
  approve(id: string, binding: string, current: { diffHash: string }) {
    const item = this.read(id);
    if (item.binding !== binding) throw Error("This change was updated.");
    if (!item.diffIntact || current.diffHash !== item.payload.diffHash)
      throw Error("This change was updated.");
    this.store.approve(id, "owner", binding);
    return item;
  }
  decline(id: string) {
    this.store.reject(id);
  }
  setProgress(id: string, progress: CodeChangeProgress) {
    this.put("progress." + id, progress);
  }
  setReceipt(id: string, receipt: CodeChangeReceipt) {
    this.put("receipt." + id, receipt);
  }
  state(id: string): StoredAction["state"] {
    return this.store.read(id).state;
  }
}
