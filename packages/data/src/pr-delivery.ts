import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { ActionStore } from "./outbox.ts";
import { bindAction } from "../../domain/src/governance.ts";
import {
  targetSchema,
  deliveryChecklist,
  prRevision,
  type MergeTarget,
} from "../../contracts/src/pr-workspace.ts";
export type Conditions = {
  head: string;
  base: string;
  merged: boolean;
  permitted: boolean;
  ready: boolean;
  methods: string[];
};
export class DeliveryReview {
  private store: ActionStore;
  constructor(private db: Database.Database) {
    this.store = new ActionStore(db);
  }
  private ready(target: MergeTarget, r: Conditions) {
    if (
      !/^[0-9a-f]{40}$/.test(r.head) ||
      target.base !== r.base ||
      r.merged ||
      !r.permitted ||
      !r.ready ||
      !r.methods.includes(target.method)
    )
      throw Error(
        "The current checks, policy or permissions do not allow this merge.",
      );
  }
  prepare(input: MergeTarget, r: Conditions) {
    const target = targetSchema.parse(input);
    this.ready(target, r);
    const id = randomUUID(),
      rev = { head: r.head };
    this.store.propose({
      id,
      productId: target.product,
      kind: "merge",
      payload: target,
      revisions: rev,
      requestedBy: "pm",
      operationMarker: id,
    });
    return { id, binding: bindAction("merge", target, rev), head: r.head };
  }
  private bound(input: MergeTarget, id: string, binding: string) {
    const action = this.store.read(id),
      target = targetSchema.parse(action.payload);
    if (
      action.kind !== "merge" ||
      target.product !== input.product ||
      bindAction("merge", target, action.revisions) !== binding
    )
      throw Error("Merge review changed.");
    const { head } = prRevision.parse(action.revisions);
    if (bindAction("merge", input, action.revisions) !== binding)
      throw Error("Merge target changed.");
    return { target, head, state: action.state };
  }
  approve(
    target: MergeTarget,
    id: string,
    binding: string,
    current: Conditions,
  ) {
    const saved = this.bound(target, id, binding);
    if (saved.head !== current.head) throw Error("PR head changed.");
    this.ready(target, current);
    this.store.approve(id, "pm", binding);
  }
  async execute(
    target: MergeTarget,
    id: string,
    binding: string,
    read: () => Promise<Conditions>,
    write: (expected: string) => Promise<void>,
  ) {
    const saved = this.bound(target, id, binding);
    if (bindAction("merge", target, { head: saved.head }) !== binding)
      throw Error("Merge target changed.");
    if (!["approved", "unknown", "succeeded"].includes(saved.state))
      throw Error("Review and approve the exact merge first.");
    const current = await read();
    if (current.head !== saved.head || current.base !== target.base) {
      if (saved.state === "approved")
        this.store.edit(id, target, { head: current.head, base: current.base });
      throw Error("The PR head or base changed. Review the new version.");
    }
    if (saved.state === "unknown" || saved.state === "succeeded") {
      if (!current.merged)
        throw Error("Merge outcome is unconfirmed. Refresh the PR.");
      if (saved.state === "unknown") this.store.finish(id, "succeeded");
      return;
    }
    this.ready(target, current);
    if (!this.store.claim("merge", id)) throw Error("Approval unavailable.");
    try {
      await write(saved.head);
      const receipt = await read();
      if (
        !receipt.merged ||
        receipt.head !== saved.head ||
        receipt.base !== target.base
      )
        throw Error();
      this.store.finish(id, "succeeded");
    } catch {
      this.store.finish(id, "unknown");
      throw Error("Merge outcome is unconfirmed. Refresh the PR.");
    }
  }
  stories(product: string, repo: string, number: number, head: string) {
    return this.db
      .prepare(
        "SELECT DISTINCT w.id,w.title FROM delivery_pull_requests p JOIN runs r ON r.id=p.run_id JOIN work_items w ON w.id=r.story_id AND w.product_id=r.product_id WHERE r.product_id=? AND p.repo=? AND p.number=? AND p.head=? ORDER BY w.title,w.id",
      )
      .all(product, repo, number, head) as { id: string; title: string }[];
  }
  decisions(action: string) {
    return this.db
      .prepare(
        "SELECT w.title AS story,a.verdict,a.rationale,a.at FROM delivery_acceptance a JOIN work_items w ON w.id=a.story_id WHERE a.action_id=? ORDER BY a.rowid",
      )
      .all(action);
  }
  accept(
    target: MergeTarget,
    current: Conditions,
    id: string,
    binding: string,
    story: string,
    verdict: "Accepted" | "Rejected" | "Blocked",
    rationale: string,
    checks: string[],
  ) {
    const saved = this.bound(target, id, binding);
    if (
      saved.state !== "succeeded" ||
      !current.merged ||
      current.head !== saved.head ||
      current.base !== target.base ||
      !rationale.trim() ||
      checks.length !== deliveryChecklist.length ||
      !deliveryChecklist.every((check) => checks.includes(check)) ||
      !this.stories(
        target.product,
        target.repo,
        target.number,
        current.head,
      ).some((s) => s.id === story)
    )
      throw Error("Review the merged PR, linked story and checklist first.");
    this.db
      .prepare(
        "INSERT INTO delivery_acceptance(id,action_id,story_id,verdict,rationale,checklist,at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(action_id,story_id,verdict,rationale,checklist) DO NOTHING",
      )
      .run(
        randomUUID(),
        id,
        story,
        verdict,
        rationale,
        JSON.stringify(deliveryChecklist),
        new Date().toISOString(),
      );
  }
}
