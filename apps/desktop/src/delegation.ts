// Firstmate hands work to an agent, and the agent's result comes back to the
// chat it was asked in.
//
// Nothing here changes Firstmate. The worker is the one Firstmate's own
// scripts start and message (packages/crew: fm-spawn.sh, fm-send.sh), in an
// Amun-owned Firstmate home. This module only writes the agent's brief,
// waits for the result file, and reports both ends to the work store.
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { agentProfile } from "../../../packages/domain/src/work/agents.ts";
import {
  acceptanceType,
  normalizeChecklist,
} from "../../../packages/domain/src/work/acceptance.ts";
import { rfpResponseDelegation } from "../../../packages/domain/src/work/rfp-boundary.ts";

export type Harness = "claude" | "codex" | "pi";
export interface DelegationDeps {
  /** Private folder holding one sub-folder per delegated job. */
  root: string;
  /** Applies a work command and tells the interface. */
  record(command: Record<string, unknown>): { ok: boolean; ref: string | null };
  /**
   * The saved documents of the job's work, as bounded, labelled reference
   * text (same group only). Empty when there are none.
   */
  sources?(areaId: string, task: string): string;
  /**
   * True only when the worker is proven not to be running any more. Unknown
   * is false: a worker that may still be alive is never given up on.
   */
  workerGone?(harness: Harness): Promise<boolean>;
  /** The work the job belongs to, or null when it no longer exists. */
  area(id: string): {
    name: string;
    type: string;
    purpose: string;
    groupId: string | null;
  } | null;
  /** The worker tool to use, or null when the owner has turned them all off. */
  harness(): Harness | null;
  /** Optional fallback worker tools to try when the primary worker encounters an issue. */
  fallbackHarnesses?(): Harness[];
  /**
   * Starts the worker and lets it reach its own prompt. "asks-trust" means
   * its tool is asking to trust the worker's folder and the owner has not
   * allowed that yet; nothing was answered.
   */
  ready(harness: Harness, allow: boolean): Promise<"ready" | "asks-trust">;
  /** The owner's recorded decision to let this worker use its own folder. */
  trust: { has(harness: Harness): boolean; grant(harness: Harness): void };
  /** Sends the instruction to the worker through Firstmate. */
  deliver(harness: Harness, id: string, text: string): Promise<void>;
  /** Removes secrets before text is shown or stored. */
  redact(text: string): string;
  /**
   * Code changes in a connected repository. Amun keeps its own copy of the
   * repository; the agent works only in the worktree it is given and never
   * commits, pushes or opens anything. The owner reviews the exact change.
   */
  code?: {
    prepare(input: {
      workAreaId: string;
      agent: string;
      title: string;
      repo: string;
    }): Promise<CodeWorktree | { refusal: string }>;
    open(id: string): Promise<CodeWorktree>;
    /** The agent finished: raises the review for the owner. */
    submit(id: string, summary: string): Promise<void>;
  };
  pollMs?: number;
  timeoutMs?: number;
}
export interface CodeWorktree {
  id: string;
  worktree: string;
  branch: string;
  base: string;
  /** owner/name */
  repo: string;
}
interface Job {
  id: string;
  workAreaId: string;
  agent: string;
  title: string;
  harness: Harness;
  activityId: string | null;
  startedAt: number;
  /** An acceptance checklist, filed as such with honest evidence. */
  acceptance?: boolean;
  state: "waiting-owner" | "sent" | "done" | "failed";
  /**
   * Whether the result is filed as a Library draft. Absent on jobs finished
   * before this was tracked.
   */
  saved?: boolean;
  /** The job changes code in Amun's own copy of a repository. */
  code?: CodeWorktree;
}
/** Crewmates whose profile fits changing code; the first is the default. */
export const codeAgents = [
  "Solution & AI Architecture",
  "Presales & Solutioning",
  "QA",
];
/** The answer that lets a worker use its own folder. */
export const allowWorker = "Allow it";
export const trustRef = (harness: Harness) => "crew-trust:" + harness;

const limit = 200_000;
const names: Record<Harness, string> = {
  claude: "Claude Code",
  codex: "Codex",
  pi: "GitHub Copilot through Pi",
};

/** The written instructions an agent works from, built from its catalogue entry. */
export function agentBrief(input: {
  agent: string;
  title: string;
  task: string;
  area: { name: string; type: string; purpose: string };
  result: string;
  sources?: string;
  acceptance?: boolean | undefined;
  code?: CodeWorktree | undefined;
  revise?: string | undefined;
}) {
  const profile = agentProfile(input.agent);
  return [
    `# ${input.title}`,
    "",
    `You are the ${input.agent} agent. Firstmate has given you this job.`,
    "",
    "## The job",
    input.task,
    ...(input.revise
      ? [
          "",
          "## The owner asked for changes",
          "You already changed this working copy. The owner read it and asked for this to be different. Update the files in place:",
          input.revise,
        ]
      : []),
    "",
    "## What it is for",
    `${input.area.type}: ${input.area.name}` +
      (input.area.purpose ? `\n${input.area.purpose}` : ""),
    ...(profile
      ? [
          "",
          "## Your role",
          profile.summary,
          "",
          `What you own: ${profile.scope}`,
          "",
          `What you produce: ${profile.outputs}`,
          ...(profile.frameworks.length
            ? [
                "",
                "Work from these where they fit:",
                ...profile.frameworks.map(
                  ([name, link]) => `- ${name}: ${link}`,
                ),
              ]
            : []),
        ]
      : []),
    ...(input.sources ? ["", "## Source documents", input.sources] : []),
    "",
    "## Rules",
    "- You report to Firstmate. Never address the owner.",
    ...(input.code
      ? [
          `- Work only inside ${JSON.stringify(input.code.worktree)}. It is Amun's own copy of ${input.code.repo}, on the new branch ${input.code.branch}. Change files there and nowhere else on this Mac.`,
          "- Do not run git commit, push, merge, rebase, branch or any command that talks to GitHub, and do not edit anything inside a .git folder. Amun commits and opens the pull request only after the owner has read your exact change.",
          "- Do not add links to files outside the project, binary files or submodules.",
          "- Make the smallest change that does the job and keep the project's existing style. Run the project's own tests if it has them and say what you ran.",
          '- In the result, start with one line "Title: <a short, plain pull request title>", then say in a few plain sentences what you changed and why.',
        ]
      : [
          "- Produce the deliverable only. Do not write to Azure DevOps, Notion, GitHub or any repository, and do not change any other file.",
        ]),
    "- If something you need is missing, say what is missing in the result instead of guessing.",
    ...(input.acceptance
      ? [
          '- This is an acceptance checklist. Write one task line per item, "- [ ] what must be true", and end each line with "Evidence:" and where it comes from: a test result, a pull request, a document, or "unknown".',
          '- Cite only evidence you can see in the source documents. If you cannot see it, write "Evidence: unknown". Never tick an item without evidence and never guess that a test passed.',
        ]
      : []),
    `- Write the finished result as Markdown to ${JSON.stringify(input.result)} and nothing else.`,
    `- When the result is complete, and only then, create an empty file named "done" in the same folder. Until that file exists your work is treated as unfinished.`,
    "",
  ].join("\n");
}

export class Delegations {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  constructor(private readonly deps: DelegationDeps) {}

  private dir(id: string) {
    return join(this.deps.root, id);
  }
  private async readResult(job: Job) {
    return this.deps.redact(
      (await readFile(join(this.dir(job.id), "result.md"), "utf8")).slice(
        0,
        limit,
      ),
    );
  }
  private async save(job: Job) {
    await writeFile(join(this.dir(job.id), "job.json"), JSON.stringify(job), {
      mode: 0o600,
    });
  }
  private say(workAreaId: string, text: string) {
    if (this.deps.area(workAreaId))
      this.deps.record({
        action: "message",
        workAreaId,
        role: "firstmate",
        text,
      });
  }

  /** Hands one job to an agent. Resolves once the worker has been told. */
  async start(input: {
    workAreaId: string;
    agent: string;
    title: string;
    task: string;
    acceptance?: boolean | undefined;
    /** A connected repository (its address) in which the job changes code. */
    repo?: string | undefined;
    /** Asks for changes to a code change already made in a worktree. */
    revise?: { codeId: string; note: string } | undefined;
  }) {
    const area = this.deps.area(input.workAreaId);
    if (!area) return null;
    const profile = agentProfile(input.agent);
    // The name shown is the catalogue's own spelling when there is one.
    const named = profile?.name ?? input.agent.trim();
    // Code and README edits go to a crewmate whose profile fits them.
    const agent =
      input.repo && !codeAgents.includes(named) ? codeAgents[0]! : named;
    if (
      rfpResponseDelegation({
        areaType: area.type,
        agent,
        title: input.title,
        task: input.task,
      })
    ) {
      this.say(
        input.workAreaId,
        `Amun only tracks this RFP: its client, owners, deadline and status. Writing the response or a proposal happens outside Amun, so I have not handed this to ${agent}. I can still record or update the RFP's details.`,
      );
      return null;
    }
    const harness = this.deps.harness();
    if (!harness) {
      this.say(
        input.workAreaId,
        `I could not give this to ${agent}: no enabled Copilot worker is available. Check the Copilot connection under Settings › Accounts and models.`,
      );
      return null;
    }
    let code: CodeWorktree | undefined;
    if (input.revise || input.repo) {
      if (!this.deps.code) {
        this.say(
          input.workAreaId,
          `I could not hand this to ${agent}: changing code in a repository is not available here.`,
        );
        return null;
      }
      try {
        const opened = input.revise
          ? await this.deps.code.open(input.revise.codeId)
          : await this.deps.code.prepare({
              workAreaId: input.workAreaId,
              agent,
              title: input.title,
              repo: input.repo!,
            });
        if ("refusal" in opened) {
          this.say(input.workAreaId, opened.refusal);
          return null;
        }
        code = opened;
      } catch (error) {
        this.say(
          input.workAreaId,
          `I could not set up a working copy for ${agent}. ` +
            (error instanceof Error && error.message
              ? this.deps.redact(error.message)
              : "Nothing was changed."),
        );
        return null;
      }
    }
    const id = randomUUID();
    const dir = this.dir(id);
    const result = join(dir, "result.md");
    await mkdir(dir, { mode: 0o700, recursive: true });
    await writeFile(
      join(dir, "brief.md"),
      agentBrief({
        ...input,
        agent,
        area,
        result,
        ...(input.acceptance ? { acceptance: true } : {}),
        code,
        revise: input.revise?.note,
        sources: this.deps.sources?.(input.workAreaId, input.task) ?? "",
      }),
      { mode: 0o600, flag: "wx" },
    );
    await writeFile(result, "", { mode: 0o600, flag: "wx" });
    const activity = this.deps.record({
      action: "activity",
      groupId: null,
      workAreaId: input.workAreaId,
      text: `${agent}: ${input.title}`.slice(0, 250),
      state: "running",
      ref: "delegation:" + id,
      silent: true,
    });
    const job: Job = {
      id,
      workAreaId: input.workAreaId,
      agent,
      title: input.title,
      harness,
      activityId: activity.ref,
      startedAt: Date.now(),
      ...(input.acceptance ? { acceptance: true } : {}),
      ...(code ? { code } : {}),
      state: "sent",
    };
    await this.save(job);
    this.deps.record({
      action: "agent-status",
      role: agent,
      state: "working",
      nowDoing: input.title,
    });
    try {
      if (!(await this.send(job))) return id;
    } catch (error) {
      const fallbacks = (this.deps.fallbackHarnesses?.() ?? []).filter(
        (h) => h !== job.harness,
      );
      let recovered = false;
      for (const nextHarness of fallbacks) {
        const previousHarness = job.harness;
        job.harness = nextHarness;
        await this.save(job);
        try {
          const sent = await this.send(job);
          this.say(
            input.workAreaId,
            `Switched ${agent} from ${names[previousHarness]} to ${names[nextHarness]} because ${names[previousHarness]} encountered an issue.`,
          );
          if (!sent) return id;
          recovered = true;
          break;
        } catch {
          // Try next fallback harness if any.
        }
      }
      if (!recovered) {
        await this.finish(job, "failed", {
          note:
            `I could not start ${agent} on ${names[harness]}. ` +
            (error instanceof Error && error.message
              ? this.deps.redact(error.message)
              : "The worker did not start."),
        });
        return null;
      }
    }
    this.watch(job);
    return id;
  }

  /**
   * Readies the worker and sends the job. Returns false when the worker's
   * tool is asking to trust its folder and the owner has not allowed it: the
   * job then waits, and the owner is asked once.
   */
  private async send(job: Job) {
    const dir = this.dir(job.id);
    const state = await this.deps.ready(
      job.harness,
      this.deps.trust.has(job.harness),
    );
    if (state === "asks-trust") {
      job.state = "waiting-owner";
      await this.save(job);
      this.deps.record({
        action: "agent-status",
        role: job.agent,
        state: "waiting",
        nowDoing: job.title,
      });
      this.deps.record({
        action: "attention",
        attentionKind: "question",
        groupId: null,
        workAreaId: job.workAreaId,
        title: `Let ${names[job.harness]} start working for ${job.agent}?`,
        detail: `${names[job.harness]} is asking to use its own Amun folder and Firstmate's own start-up scripts. I have checked both against the Firstmate version Amun uses. It does not get access to anything else on this Mac, and I will not ask again for this folder.`,
        ref: trustRef(job.harness),
        options: [allowWorker],
      });
      return false;
    }
    job.state = "sent";
    await this.save(job);
    await this.deps.deliver(
      job.harness,
      job.id,
      `Job from Firstmate for the ${job.agent} agent. Read ${JSON.stringify(join(dir, "brief.md"))}. ` +
        `Write ONLY ${JSON.stringify(join(dir, "result.md"))} as a private mode 0600 Markdown file, then create an empty file ${JSON.stringify(join(dir, "done"))}. ` +
        (job.code
          ? `Change files only inside ${JSON.stringify(job.code.worktree)}; do not commit or push.`
          : "Do not change any other file."),
    );
    return true;
  }

  /** The owner allowed this worker's folder: record it and send what waited. */
  async allow(harness: Harness) {
    this.deps.trust.grant(harness);
    for (const job of await this.jobs())
      if (job.state === "waiting-owner" && job.harness === harness) {
        this.deps.record({
          action: "agent-status",
          role: job.agent,
          state: "working",
          nowDoing: job.title,
        });
        try {
          if (await this.send(job)) this.watch(job);
        } catch (error) {
          await this.finish(job, "failed", {
            note:
              `I could not start ${job.agent} on ${names[harness]}. ` +
              (error instanceof Error && error.message
                ? this.deps.redact(error.message)
                : "The worker did not start."),
          });
        }
      }
  }

  private async jobs() {
    const found: Job[] = [];
    let entries: string[] = [];
    try {
      entries = await readdir(this.deps.root);
    } catch {
      return found;
    }
    for (const entry of entries) {
      try {
        const job = JSON.parse(
          await readFile(join(this.deps.root, entry, "job.json"), "utf8"),
        ) as Job;
        if (job.id === entry) found.push(job);
      } catch {
        // A folder without a readable record is not a job.
      }
    }
    return found;
  }

  /**
   * After a restart, keeps waiting for jobs already sent and files any
   * finished result that never reached the Library. Sends nothing to a worker.
   */
  async resume() {
    for (const job of await this.jobs()) {
      if (job.state === "sent") this.watch(job);
      else if (job.state === "done" || job.state === "failed")
        await this.recover(job).catch(() => undefined);
    }
  }

  private async recover(job: Job) {
    if (job.saved === true) return;
    const area = this.deps.area(job.workAreaId);
    if (!area) return;
    // Before this was tracked, an output with no group was filed correctly;
    // only grouped work lost its draft, and only a finished job is retried.
    if (job.saved === undefined && (job.state !== "done" || !area.groupId)) {
      job.saved = true;
      await this.save(job);
      return;
    }
    const text = (await this.readResult(job)).trim();
    if (!text) return;
    if (await this.file(job, text))
      this.say(
        job.workAreaId,
        `I have saved ${job.agent}'s result for “${job.title}” as a draft in the Library.`,
      );
  }

  /** Files the result as a draft. Safe to repeat: the draft has a fixed id. */
  private async file(job: Job, text: string) {
    const area = this.deps.area(job.workAreaId);
    if (!area) return false;
    let ok = false;
    try {
      ok = this.deps.record({
        action: "save-output",
        outputId: "delegation-" + job.id,
        groupId: area.groupId,
        type: job.acceptance ? acceptanceType : "doc",
        title: `${job.title} (${job.agent})`.slice(0, 250),
        body: job.acceptance
          ? normalizeChecklist(text.slice(0, 90_000))
          : text.slice(0, 90_000),
        workAreaIds: [job.workAreaId],
        author: "agent",
      }).ok;
    } catch {
      ok = false;
    }
    job.saved = ok;
    await this.save(job).catch(() => undefined);
    return ok;
  }

  private watch(job: Job) {
    const every = this.deps.pollMs ?? 4000;
    const until = job.startedAt + (this.deps.timeoutMs ?? 30 * 60_000);
    const exists = (name: string) =>
      stat(join(this.dir(job.id), name)).then(
        (file) => file.size,
        () => -1,
      );
    const read = () => this.readResult(job);
    const tick = async () => {
      this.timers.delete(job.id);
      const size = await exists("result.md");
      // Finished only when the worker says so. A pause in writing is not a
      // result: the worker may still be reviewing or extending it.
      if ((await exists("done")) >= 0 && size > 0) {
        await this.finish(job, "done", { text: await read() });
        return;
      }
      if (
        size <= 0 &&
        (await exists("done")) < 0 &&
        (await this.deps.workerGone?.(job.harness).catch(() => false))
      ) {
        // Nothing is resent: the owner asks again, so no job is run twice.
        await this.finish(job, "failed", {
          note: `${job.agent} is no longer running, so “${job.title}” was not finished and no result came back. Nothing was lost; ask me to try again.`,
        });
        return;
      }
      if (Date.now() > until) {
        const minutes = Math.round(
          (this.deps.timeoutMs ?? 30 * 60_000) / 60_000,
        );
        // What it had written is passed on, labelled as unconfirmed.
        await this.finish(
          job,
          "failed",
          size > 0
            ? {
                text: await read(),
                note: `${job.agent} did not confirm “${job.title}” was finished after ${minutes} minutes, so I have stopped waiting. This is what it had written so far and may be incomplete:`,
              }
            : {
                note: `${job.agent} has not finished “${job.title}” after ${minutes} minutes, so I have stopped waiting. Nothing was lost; ask me to try again.`,
              },
        );
        return;
      }
      this.timers.set(
        job.id,
        setTimeout(() => void tick(), every),
      );
    };
    this.timers.set(
      job.id,
      setTimeout(() => void tick(), every),
    );
  }

  private async finish(
    job: Job,
    state: "done" | "failed",
    outcome: { text?: string; note?: string },
  ) {
    job.state = state;
    const text = outcome.text?.trim() ?? "";
    // Marked unsaved first, so a restart before the draft is filed retries it.
    if (text) job.saved = false;
    await this.save(job).catch(() => undefined);
    this.deps.record({
      action: "agent-status",
      role: job.agent,
      state: state === "done" ? "done" : "idle",
      nowDoing: null,
      ...(text ? { output: text } : {}),
    });
    if (job.activityId)
      this.deps.record({
        action: "activity",
        activityId: job.activityId,
        groupId: null,
        workAreaId: job.workAreaId,
        text: `${job.agent}: ${job.title}`.slice(0, 250),
        state: state === "done" ? "finished" : "failed",
        silent: true,
      });
    if (!this.deps.area(job.workAreaId)) return;
    if (text && state === "done" && job.code && this.deps.code) {
      // The change goes to the owner as an exact review, not to the Library.
      try {
        await this.deps.code.submit(job.code.id, text);
        return;
      } catch (error) {
        this.say(
          job.workAreaId,
          `${job.agent} finished, but I could not prepare the change for your review. ` +
            (error instanceof Error && error.message
              ? this.deps.redact(error.message)
              : "Nothing was sent."),
        );
        return;
      }
    }
    if (text) {
      // Kept as a draft beside the conversation, and said in the chat. The
      // card marks it as an agent's work, so Firstmate is told about it with
      // the owner's next message and can build on the real text.
      const saved = await this.file(job, text);
      this.deps.record({
        action: "message",
        workAreaId: job.workAreaId,
        role: "firstmate",
        text:
          (state === "done"
            ? `${job.agent} has finished “${job.title}”.`
            : (outcome.note ?? "")) +
          (saved
            ? ""
            : "\n\nI could not save this as a draft in the Library. The result is kept and I will try again when Amun restarts.") +
          `\n\n${text.slice(0, 12_000)}`,
        card: { kind: "agent-result", agent: job.agent, title: job.title },
      });
    } else
      this.deps.record({
        action: "message",
        workAreaId: job.workAreaId,
        role: "firstmate",
        text: outcome.note ?? `${job.agent} did not finish “${job.title}”.`,
        card: { kind: "agent-result", agent: job.agent, title: job.title },
      });
  }

  close() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
