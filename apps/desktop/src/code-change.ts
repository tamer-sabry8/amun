// A crewmate's code change, from Amun's own copy of the repository to an
// owner-approved pull request. Firstmate never edits code: it hands the job to
// a crewmate, receives the result, and puts the exact change in front of the
// owner. Only the owner's approval of that exact change lets anything leave
// this Mac, and nothing is ever merged or pushed to the default branch.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type Database from "better-sqlite3";
import type { CodeChangeCard } from "../../../packages/contracts/src/code-change.ts";
import {
  CodeChangeReview,
  pullMarker,
  type CodeChangePayload,
} from "../../../packages/data/src/code-change.ts";
import {
  branchName,
  CodeChangeError,
  type CodeWorkspace,
} from "./code-workspace.ts";
import { canWrite, cannotWrite, type CodeHost } from "./github-code.ts";
import { repositoryTarget } from "./pr-repositories.ts";

export interface Meta {
  id: string;
  product: string;
  workAreaId: string;
  agent: string;
  title: string;
  origin: string;
  owner: string;
  name: string;
  url: string;
  base: string;
  branch: string;
}
export interface CodeChangeDeps {
  db: Database.Database;
  /** Amun's own store: copies of repositories live below it. */
  root: string;
  workspace: CodeWorkspace;
  host(origin: string, owner: string, repo: string, token: string): CodeHost;
  /** Every sign-in saved for this host, best candidate first. */
  tokens(origin: string): Promise<string[]>;
  /** Says something in the conversation the job came from. */
  say(workAreaId: string, text: string): void;
  /** Asks the crewmate to revise its change in the same working copy. */
  revise(meta: Meta, note: string): Promise<void>;
  /** Records an unexpected failure with secrets removed. */
  report?(event: string, error: unknown): void;
}
export const connectGithubFirst =
  "Connect GitHub in Settings › Tools first, then ask again.";

const states: Record<string, CodeChangeCard["state"]> = {
  pending_approval: "waiting",
  approved: "approved",
  executing: "opening",
  succeeded: "open",
  unknown: "unconfirmed",
  rejected: "declined",
};

/** The title and details a crewmate wrote, with the job's name as a fallback. */
export function describeChange(title: string, summary: string) {
  const lines = summary.split(/\r?\n/);
  const found = lines.findIndex((line) => /^\s*title\s*:/i.test(line));
  const first =
    found >= 0 ? lines[found]!.replace(/^\s*title\s*:\s*/i, "").trim() : "";
  const subject = (first || title).replace(/\s+/g, " ").slice(0, 100);
  const details = lines
    .filter((_, index) => index !== found)
    .join("\n")
    .trim()
    .slice(0, 3000);
  return {
    title: subject,
    message: details ? `${subject}\n\n${details}` : subject,
  };
}

const pullBody = (id: string, message: string) =>
  [
    message.split("\n").slice(2).join("\n").trim(),
    "Opened by Amun after owner approval.",
    pullMarker(id),
  ]
    .filter(Boolean)
    .join("\n\n");

export class CodeChanges {
  readonly review: CodeChangeReview;
  constructor(private readonly deps: CodeChangeDeps) {
    this.review = new CodeChangeReview(deps.db);
  }
  private dir(id: string) {
    return join(this.deps.root, "code", id);
  }
  async meta(id: string): Promise<Meta> {
    return JSON.parse(
      await readFile(join(this.dir(id), "meta.json"), "utf8"),
    ) as Meta;
  }

  /** The first sign-in that can write here, or the reason none can. */
  private async choose(m: Pick<Meta, "origin" | "owner" | "name">) {
    const tokens = await this.deps.tokens(m.origin).catch(() => []);
    let seen:
      | {
          token: string;
          host: CodeHost;
          access: Awaited<ReturnType<CodeHost["access"]>>;
        }
      | undefined;
    for (const token of tokens) {
      try {
        const host = this.deps.host(m.origin, m.owner, m.name, token);
        const access = await host.access();
        if (canWrite(access)) return { token, host, access, writable: true };
        seen ??= { token, host, access };
      } catch {
        // This sign-in does not work for the repository; try the next one.
      }
    }
    if (!seen) throw new CodeChangeError(connectGithubFirst);
    return { ...seen, writable: false };
  }

  /** Copies the repository into Amun's store and makes the crewmate's worktree. */
  async prepare(input: {
    product: string;
    workAreaId: string;
    agent: string;
    title: string;
    repo: string;
  }) {
    const target = repositoryTarget(input.repo);
    if (target.provider !== "GitHub")
      throw new CodeChangeError(
        "Amun can open pull requests on GitHub repositories only.",
      );
    const m = { origin: target.origin, owner: target.owner, name: target.repo };
    const chosen = await this.choose(m);
    const id = randomUUID();
    const branch = branchName(input.title, id);
    const meta: Meta = {
      id,
      product: input.product,
      workAreaId: input.workAreaId,
      agent: input.agent,
      title: input.title,
      ...m,
      url: target.url,
      base: chosen.access.defaultBranch,
      branch,
    };
    await mkdir(this.dir(id), { recursive: true, mode: 0o700 });
    const { worktree } = await this.deps.workspace.prepare({
      id,
      origin: m.origin,
      owner: m.owner,
      repo: m.name,
      base: meta.base,
      branch,
      token: chosen.token,
    });
    await writeFile(join(this.dir(id), "meta.json"), JSON.stringify(meta), {
      mode: 0o600,
    });
    return { meta, worktree };
  }

  /** The crewmate is done: raise the review card, or say why there is none. */
  async submit(id: string, summary: string) {
    const meta = await this.meta(id);
    const found = await this.deps.workspace.collect(id, meta.branch);
    const say = (text: string) => this.deps.say(meta.workAreaId, text);
    if (!found.ok) return say(`${meta.agent} finished, but ${found.reason}`);
    if (found.empty)
      return say(
        `${meta.agent} finished, but nothing in ${meta.owner}/${meta.name} changed, so there is nothing to open a pull request for.`,
      );
    const text = describeChange(meta.title, summary);
    const payload: CodeChangePayload = {
      repo: { owner: meta.owner, name: meta.name, url: meta.url },
      base: meta.base,
      branch: meta.branch,
      message: text.message,
      title: text.title,
      files: found.files,
      diffHash: found.diffHash,
      job: id,
      workAreaId: meta.workAreaId,
    };
    this.review.propose(meta.product, payload, found.baseSha, found.diff);
    say(
      `${meta.agent} has changed ${found.files.length} file${found.files.length === 1 ? "" : "s"} in ${meta.owner}/${meta.name}. Open Pull requests to read the exact change. Nothing leaves your Mac until you approve it, and nothing is merged.`,
    );
  }

  /**
   * The work areas whose changes show in this pane: the product's own areas
   * and the area the pane is open in, whichever product was recorded when the
   * job was handed over.
   */
  private areas(product: string, workAreaId?: string) {
    const found = (
      this.deps.db
        .prepare("SELECT id FROM work_areas WHERE product_id=?")
        .pluck()
        .all(product) as string[]
    ).map(String);
    return workAreaId ? [...found, workAreaId] : found;
  }
  private owns(
    item: { revisions: { product: string }; payload: { workAreaId: string } },
    product: string,
    workAreaId?: string,
  ) {
    return (
      item.revisions.product === product ||
      this.areas(product, workAreaId).includes(item.payload.workAreaId)
    );
  }

  /** What the owner sees for each change. */
  async cards(product: string, workAreaId?: string): Promise<CodeChangeCard[]> {
    const cards: CodeChangeCard[] = [];
    for (const item of this.review.list(
      product,
      20,
      this.areas(product, workAreaId),
    )) {
      const { payload, action } = item;
      const state = states[action.state] ?? "failed";
      let blocker: string | undefined;
      if (!item.diffIntact)
        blocker =
          "This change can't be shown in full, so it can't be approved.";
      else if (state === "waiting") {
        const chosen = await this.choose({
          origin: new URL(payload.repo.url).origin,
          owner: payload.repo.owner,
          name: payload.repo.name,
        }).catch((error: unknown) => {
          if (error instanceof CodeChangeError) return error;
          this.deps.report?.("code-change.access.failed", error);
          return new CodeChangeError(
            "Amun could not check your GitHub access just now. Try again in a moment.",
          );
        });
        if (chosen instanceof CodeChangeError) blocker = chosen.message;
        else if (!chosen.writable)
          blocker = cannotWrite(`${payload.repo.owner}/${payload.repo.name}`);
      }
      cards.push({
        id: action.id,
        product,
        repo: payload.repo,
        base: payload.base,
        branch: payload.branch,
        message: payload.message,
        files: payload.files,
        diff: item.diff,
        diffHash: payload.diffHash,
        binding: item.binding,
        state,
        ...(blocker ? { blocker } : {}),
        ...(item.receipt
          ? {
              pull: {
                number: item.receipt.number,
                url: item.receipt.url,
                commit: item.receipt.commit,
              },
            }
          : {}),
      });
    }
    return cards;
  }

  /** The owner approved this exact change. */
  async approve(
    product: string,
    reviewId: string,
    binding: string,
    workAreaId?: string,
  ) {
    const item = this.review.read(reviewId);
    const meta = await this.meta(item.payload.job);
    if (!this.owns(item, product, workAreaId)) throw Error("Product changed.");
    const m = {
      origin: meta.origin,
      owner: meta.owner,
      name: meta.name,
    };
    const state = item.action.state;
    if (state === "unknown") return this.reconcile(reviewId, meta);
    if (state === "succeeded") return this.finished(reviewId);
    if (!["pending_approval", "approved"].includes(state))
      throw new CodeChangeError("This change can't be approved any more.");
    const chosen = await this.choose(m);
    if (!chosen.writable)
      throw new CodeChangeError(cannotWrite(`${meta.owner}/${meta.name}`));
    if (state === "pending_approval") {
      const now = await this.deps.workspace.collect(meta.id, meta.branch);
      if (
        !now.ok ||
        now.empty ||
        now.diffHash !== item.payload.diffHash ||
        item.binding !== binding
      ) {
        this.review.decline(reviewId);
        throw new CodeChangeError(
          "This change was updated, so the approval was not used. Review it again.",
        );
      }
      this.review.approve(reviewId, binding, { diffHash: now.diffHash });
    } else if (item.binding !== binding)
      throw new CodeChangeError("This change was updated.");
    return this.execute(reviewId, meta, chosen);
  }

  private finished(id: string) {
    const r = this.review.read(id).receipt;
    return r ? `Pull request #${r.number} is open: ${r.url}` : "Done.";
  }

  private async record(
    id: string,
    meta: Meta,
    pull: { number: number; url: string },
    commit: string,
  ) {
    this.review.setReceipt(id, {
      repo: `${meta.owner}/${meta.name}`,
      branch: meta.branch,
      commit,
      number: pull.number,
      url: pull.url,
    });
    this.review.store.finish(id, "succeeded");
    const text = `Pull request #${pull.number} is open: ${pull.url}`;
    this.deps.say(meta.workAreaId, text);
    return text;
  }

  private async execute(
    id: string,
    meta: Meta,
    chosen: { token: string; host: CodeHost },
  ) {
    if (!this.review.store.claim("code_change", id))
      throw new CodeChangeError("This approval is already being used.");
    const item = this.review.read(id);
    let sent = false;
    try {
      const existing = await chosen.host.findPull(meta.branch);
      if (existing)
        return await this.record(
          id,
          meta,
          existing,
          item.progress.commit ?? "0".repeat(40),
        );
      let commit = item.progress.commit;
      if (!commit) {
        const now = await this.deps.workspace.collect(meta.id, meta.branch);
        if (!now.ok || now.empty || now.diffHash !== item.payload.diffHash)
          throw new CodeChangeError(
            "This change was updated, so nothing was sent. Review it again.",
          );
        const who = await chosen.host.viewer();
        commit = await this.deps.workspace.commit(
          meta.id,
          meta.branch,
          item.payload.message,
          { name: who.name, email: who.email },
        );
        this.review.setProgress(id, { commit });
      }
      const remote = await this.deps.workspace.remoteHead(
        meta.id,
        meta.branch,
        chosen.token,
      );
      if (remote && remote !== commit)
        throw new CodeChangeError(
          "A branch with that name is already on GitHub with different work, so nothing was sent. Ask Firstmate to try again.",
        );
      if (!remote) {
        sent = true;
        await this.deps.workspace.push(
          meta.id,
          meta.branch,
          meta.base,
          chosen.token,
        );
      }
      this.review.setProgress(id, { commit, pushed: true });
      const pull = await chosen.host.createPull({
        title: item.payload.title,
        body: pullBody(id, item.payload.message),
        head: meta.branch,
        base: meta.base,
      });
      return await this.record(id, meta, pull, commit);
    } catch (error) {
      // A refusal before anything was sent is a clean failure; anything else
      // may have reached GitHub, so it is looked up later and never repeated.
      if (error instanceof CodeChangeError && !sent) {
        this.review.store.finish(id, "failed");
        this.deps.say(meta.workAreaId, error.message);
        throw error;
      }
      this.review.store.finish(id, "unknown");
      throw new CodeChangeError(
        "I couldn't confirm that GitHub received it. Check again in Pull requests; nothing is sent twice.",
      );
    }
  }

  /** Looks up what GitHub has. It never pushes again. */
  private async reconcile(id: string, meta: Meta) {
    const chosen = await this.choose(meta);
    const item = this.review.read(id);
    const found = await chosen.host.findPull(meta.branch);
    if (found)
      return this.record(
        id,
        meta,
        found,
        item.progress.commit ?? "0".repeat(40),
      );
    const remote = await this.deps.workspace
      .remoteHead(meta.id, meta.branch, chosen.token)
      .catch(() => "unreachable" as const);
    if (remote === "unreachable")
      throw new CodeChangeError(
        "I couldn't reach GitHub to check. Try again in a moment.",
      );
    if (!remote) {
      this.review.store.finish(id, "failed");
      throw new CodeChangeError(
        "Nothing reached GitHub, so no pull request was opened. Ask Firstmate to try again.",
      );
    }
    if (item.progress.commit && remote === item.progress.commit) {
      const pull = await chosen.host.createPull({
        title: item.payload.title,
        body: pullBody(id, item.payload.message),
        head: meta.branch,
        base: meta.base,
      });
      return this.record(id, meta, pull, remote);
    }
    throw new CodeChangeError(
      "The branch on GitHub isn't the one I sent, so I left it alone.",
    );
  }

  /** The owner wants something different: nothing is sent, the crewmate is asked. */
  async changes(
    product: string,
    reviewId: string,
    note: string,
    workAreaId?: string,
  ) {
    const item = this.review.read(reviewId);
    if (!this.owns(item, product, workAreaId)) throw Error("Product changed.");
    if (item.action.state !== "pending_approval")
      throw new CodeChangeError("This change can't be edited any more.");
    const meta = await this.meta(item.payload.job);
    this.review.decline(reviewId);
    this.deps.say(
      meta.workAreaId,
      `Understood. I've asked ${meta.agent} to change it. Nothing was sent.`,
    );
    await this.deps.revise(meta, note);
  }
}
