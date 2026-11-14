import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentBrief,
  Delegations,
  type DelegationDeps,
  type Harness,
} from "../src/delegation.ts";

// Firstmate hands a job to an agent; a worker does it; the result comes back
// to the chat. The worker here is a stand-in that writes the result file, the
// way a real Claude Code or Codex worker is told to.
let root: string;
let commands: Record<string, unknown>[];
let delivered: { harness: Harness; id: string; text: string }[];
let open: Delegations[];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "amun-delegation-"));
  commands = [];
  delivered = [];
  open = [];
});
afterEach(async () => {
  for (const item of open) item.close();
  await rm(root, { recursive: true, force: true });
});

const area = { name: "Arabic Voice", type: "Product", purpose: "Voice notes" };
function make(extra: Partial<DelegationDeps> = {}) {
  const delegations = new Delegations({
    root,
    record(command) {
      commands.push(command);
      return { ok: true, ref: "ref-" + commands.length };
    },
    area: (id) => (id === "area-1" ? area : null),
    harness: () => "claude",
    async deliver(harness, id, text) {
      delivered.push({ harness, id, text });
    },
    redact: (text) => text.replaceAll("sk-secret", "[removed]"),
    pollMs: 15,
    timeoutMs: 2000,
    ...extra,
  });
  open.push(delegations);
  return delegations;
}
const job = {
  workAreaId: "area-1",
  agent: "qa",
  title: "Check the booking flow",
  task: "Test the booking flow end to end and list what breaks.",
};
const of = (action: string) =>
  commands.filter((command) => command.action === action);
const until = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(done()).toBe(true);
};
/** What a worker does: read the brief, write the result. */
const work = (id: string, text: string) =>
  writeFile(join(root, id, "result.md"), text, { mode: 0o600 });

it("gives the agent a brief built from its catalogue entry", () => {
  const brief = agentBrief({
    agent: "QA",
    title: job.title,
    task: job.task,
    area,
    result: "/tmp/result.md",
  });
  expect(brief).toContain("You are the QA agent");
  expect(brief).toContain(job.task);
  expect(brief).toContain("Product: Arabic Voice");
  // Scope, outputs and frameworks come from the catalogue, not the model.
  expect(brief).toContain("What you own:");
  expect(brief).toContain("What you produce:");
  expect(brief).toContain("Never address the owner");
  expect(brief).toContain("Do not write to Azure DevOps, Notion, GitHub");
  expect(brief).toContain('"/tmp/result.md"');
});

it("starts a worker, shows who is working, and brings the result back to the chat", async () => {
  const delegations = make();
  const id = (await delegations.start(job))!;
  expect(id).toBeTruthy();

  // The worker was told through Firstmate, once, where to read and write.
  expect(delivered).toHaveLength(1);
  expect(delivered[0]).toMatchObject({ harness: "claude", id });
  expect(delivered[0]!.text).toContain(join(root, id, "brief.md"));
  expect(delivered[0]!.text).toContain(join(root, id, "result.md"));
  expect(await readFile(join(root, id, "brief.md"), "utf8")).toContain(
    job.task,
  );
  expect((await stat(join(root, id, "brief.md"))).mode & 0o077).toBe(0);

  // The Agents screen: QA, by its catalogue name, working on this.
  expect(of("agent-status")).toEqual([
    {
      action: "agent-status",
      role: "QA",
      state: "working",
      nowDoing: job.title,
    },
  ]);
  // Nothing has been said in the chat yet: there is no result to report.
  expect(of("message")).toEqual([]);

  await work(id, "## Findings\n\n1. Double booking is possible. sk-secret");
  await until(() => of("message").length === 1);

  expect(of("message")[0]).toMatchObject({
    workAreaId: "area-1",
    role: "firstmate",
  });
  const said = String(of("message")[0]!.text);
  expect(said).toContain("QA has finished “Check the booking flow”.");
  expect(said).toContain("Double booking is possible.");
  // Secrets never reach the chat or the saved draft.
  expect(said).not.toContain("sk-secret");
  expect(of("save-output")[0]).toMatchObject({
    title: "Check the booking flow (QA)",
    workAreaIds: ["area-1"],
  });
  expect(String(of("save-output")[0]!.body)).not.toContain("sk-secret");
  expect(of("agent-status").at(-1)).toMatchObject({
    role: "QA",
    state: "done",
    nowDoing: null,
  });
  expect(of("activity").map((command) => command.state)).toEqual([
    "running",
    "finished",
  ]);
});

it("uses Codex when that is the tool that is on, and says so when none is", async () => {
  await make({ harness: () => "codex" }).start(job);
  expect(delivered[0]!.harness).toBe("codex");

  commands = [];
  delivered = [];
  expect(await make({ harness: () => null }).start(job)).toBeNull();
  expect(delivered).toEqual([]);
  expect(String(of("message")[0]!.text)).toContain(
    "Claude Code and Codex are both turned off",
  );
  expect(of("agent-status")).toEqual([]);
});

it("says plainly when the worker could not be started, and frees the agent", async () => {
  const delegations = make({
    deliver: async () => {
      throw Error("Worker endpoint unavailable.");
    },
  });
  expect(await delegations.start(job)).toBeNull();
  expect(String(of("message")[0]!.text)).toBe(
    "I could not start QA on Claude Code. Worker endpoint unavailable.",
  );
  expect(of("agent-status").map((command) => command.state)).toEqual([
    "working",
    "idle",
  ]);
  expect(of("activity").at(-1)).toMatchObject({ state: "failed" });
  expect(of("save-output")).toEqual([]);
});

it("stops waiting after the time limit and never invents a result", async () => {
  await make({ timeoutMs: 60 }).start(job);
  await until(() => of("message").length === 1);
  expect(String(of("message")[0]!.text)).toContain("has not finished");
  expect(of("save-output")).toEqual([]);
  expect(of("agent-status").at(-1)).toMatchObject({ state: "idle" });
});

it("after a restart keeps waiting for a job already sent, without sending it again", async () => {
  const first = make();
  const id = (await first.start(job))!;
  first.close();
  expect(delivered).toHaveLength(1);

  const second = make();
  await second.resume();
  await work(id, "Late but complete.");
  await until(() => of("message").length === 1);
  expect(delivered).toHaveLength(1);
  expect(String(of("message")[0]!.text)).toContain("Late but complete.");

  // A finished job is not picked up again.
  const before = commands.length;
  const third = make();
  await third.resume();
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(commands.length).toBe(before);
});

it("does nothing for a work that no longer exists", async () => {
  expect(await make().start({ ...job, workAreaId: "deleted" })).toBeNull();
  expect(commands).toEqual([]);
  expect(delivered).toEqual([]);
});
