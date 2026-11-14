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

export type Harness = "claude" | "codex";
export interface DelegationDeps {
  /** Private folder holding one sub-folder per delegated job. */
  root: string;
  /** Applies a work command and tells the interface. */
  record(command: Record<string, unknown>): { ok: boolean; ref: string | null };
  /** The work the job belongs to, or null when it no longer exists. */
  area(id: string): { name: string; type: string; purpose: string } | null;
  /** The worker tool to use, or null when the owner has turned them all off. */
  harness(): Harness | null;
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
  pollMs?: number;
  timeoutMs?: number;
}
interface Job {
  id: string;
  workAreaId: string;
  agent: string;
  title: string;
  harness: Harness;
  activityId: string | null;
  startedAt: number;
  state: "waiting-owner" | "sent" | "done" | "failed";
}
/** The answer that lets a worker use its own folder. */
export const allowWorker = "Allow it";
export const trustRef = (harness: Harness) => "crew-trust:" + harness;

const limit = 200_000;
const names: Record<Harness, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

/** The written instructions an agent works from, built from its catalogue entry. */
export function agentBrief(input: {
  agent: string;
  title: string;
  task: string;
  area: { name: string; type: string; purpose: string };
  result: string;
}) {
  const profile = agentProfile(input.agent);
  return [
    `# ${input.title}`,
    "",
    `You are the ${input.agent} agent. Firstmate has given you this job.`,
    "",
    "## The job",
    input.task,
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
    "",
    "## Rules",
    "- You report to Firstmate. Never address the owner.",
    "- Produce the deliverable only. Do not write to Azure DevOps, Notion, GitHub or any repository, and do not change any other file.",
    "- If something you need is missing, say what is missing in the result instead of guessing.",
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
  }) {
    const area = this.deps.area(input.workAreaId);
    if (!area) return null;
    const profile = agentProfile(input.agent);
    // The name shown is the catalogue's own spelling when there is one.
    const agent = profile?.name ?? input.agent.trim();
    const harness = this.deps.harness();
    if (!harness) {
      this.say(
        input.workAreaId,
        `I could not give this to ${agent}: Claude Code and Codex are both turned off under Settings › Tools on this Mac.`,
      );
      return null;
    }
    const id = randomUUID();
    const dir = this.dir(id);
    const result = join(dir, "result.md");
    await mkdir(dir, { mode: 0o700, recursive: true });
    await writeFile(
      join(dir, "brief.md"),
      agentBrief({ ...input, agent, area, result }),
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
      await this.finish(job, "failed", {
        note:
          `I could not start ${agent} on ${names[harness]}. ` +
          (error instanceof Error && error.message
            ? this.deps.redact(error.message)
            : "The worker did not start."),
      });
      return null;
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
        `Write ONLY ${JSON.stringify(join(dir, "result.md"))} as a private mode 0600 Markdown file, then create an empty file ${JSON.stringify(join(dir, "done"))}. Do not change any other file.`,
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

  /** After a restart, keeps waiting for jobs already sent. Sends nothing. */
  async resume() {
    let entries: string[] = [];
    try {
      entries = await readdir(this.deps.root);
    } catch {
      return;
    }
    for (const entry of entries) {
      try {
        const job = JSON.parse(
          await readFile(join(this.deps.root, entry, "job.json"), "utf8"),
        ) as Job;
        if (job.state === "sent" && job.id === entry) this.watch(job);
      } catch {
        // A folder without a readable record is not a job to wait for.
      }
    }
  }

  private watch(job: Job) {
    const every = this.deps.pollMs ?? 4000;
    const until = job.startedAt + (this.deps.timeoutMs ?? 30 * 60_000);
    const exists = (name: string) =>
      stat(join(this.dir(job.id), name)).then(
        (file) => file.size,
        () => -1,
      );
    const read = async () =>
      this.deps.redact(
        (await readFile(join(this.dir(job.id), "result.md"), "utf8")).slice(
          0,
          limit,
        ),
      );
    const tick = async () => {
      this.timers.delete(job.id);
      const size = await exists("result.md");
      // Finished only when the worker says so. A pause in writing is not a
      // result: the worker may still be reviewing or extending it.
      if ((await exists("done")) >= 0 && size > 0) {
        await this.finish(job, "done", { text: await read() });
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
    await this.save(job).catch(() => undefined);
    const text = outcome.text?.trim() ?? "";
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
    if (text) {
      // Kept as a draft beside the conversation, and said in the chat. The
      // card marks it as an agent's work, so Firstmate is told about it with
      // the owner's next message and can build on the real text.
      this.deps.record({
        action: "save-output",
        groupId: null,
        type: "doc",
        title: `${job.title} (${job.agent})`.slice(0, 250),
        body: text.slice(0, 90_000),
        workAreaIds: [job.workAreaId],
      });
      this.deps.record({
        action: "message",
        workAreaId: job.workAreaId,
        role: "firstmate",
        text:
          (state === "done"
            ? `${job.agent} has finished “${job.title}”.`
            : (outcome.note ?? "")) + `\n\n${text.slice(0, 12_000)}`,
        card: { kind: "agent-result", agent: job.agent, title: job.title },
      });
    } else
      this.say(
        job.workAreaId,
        outcome.note ?? `${job.agent} did not finish “${job.title}”.`,
      );
  }

  close() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
