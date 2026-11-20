import { describe, expect, it } from "vitest";
import type { AmunTransport } from "../src/daemon/amun-client.ts";
import { ContractAdapter } from "../src/daemon/contract-adapter.ts";
import { NoticeQueue } from "../src/daemon/firstmate-notices.ts";
import { openWorkStore } from "../../work-store/src/index.ts";

/** A daemon with the real work store and a Firstmate that records prompts. */
class FakeDaemon implements AmunTransport {
  prompts: string[] = [];
  reply = "Noted.";
  down = false;
  work = openWorkStore(":memory:").store;
  async request<T>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    if (method === "work.snapshot") return this.work.snapshot() as T;
    if (method === "work.command")
      return this.work.handle({
        ...(params.command as object),
        version: 1,
        kind: "work",
      }) as T;
    if (method === "spaces.list") return [{ slug: "home", name: "Home" }] as T;
    if (method === "fleet.snapshot") return { tasks: [] } as T;
    if (method === "holds.list") return [] as T;
    if (method === "primary.send") {
      if (this.down) throw new Error("Firstmate is not running.");
      this.prompts.push(String(params.text));
      return { reply: this.reply } as T;
    }
    return {} as T;
  }
  onEvent(): () => void {
    return () => {};
  }
  onStatus(): () => void {
    return () => {};
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean) {
  for (let turn = 0; turn < 200 && !check(); turn += 1) await wait(5);
  expect(check()).toBe(true);
}

async function setup() {
  const daemon = new FakeDaemon();
  const adapter = new ContractAdapter(daemon, () => "2026-11-20T00:00:00Z", {
    delayMs: 10,
    retryMs: 10,
    keep: null,
  });
  await adapter.handle({ version: 1, kind: "work", action: "snapshot" });
  const send = (action: string, payload: object = {}) =>
    adapter.handle({ version: 1, kind: "work", action, ...payload });
  return { daemon, adapter, send };
}
const ref = (events: unknown[]) =>
  (events as { kind?: string; ref?: string | null; ok?: boolean }[]).find(
    (event) => event.kind === "work-result",
  )!;

describe("the owner's on-screen actions reach Firstmate", () => {
  it("tells Firstmate about an RFP tracked from the RFPs screen, with its card", async () => {
    const { daemon, send } = await setup();
    const made = ref(
      await send("save-rfp", {
        groupId: null,
        name: "Smart parking analytics",
        client: "DMT",
        deadline: "2026-12-14T00:00:00.000Z",
      }),
    );
    expect(made.ok).toBe(true);
    await until(() => daemon.prompts.length === 1);
    const prompt = daemon.prompts[0]!;
    expect(prompt).toContain("A note from Amun, not typed by the captain");
    expect(prompt).toContain(
      "started tracking the RFP “Smart parking analytics” for DMT, due 2026-12-14",
    );
    expect(prompt).toContain('"name": "Smart parking analytics"');
    expect(prompt).toContain('"client": "DMT"');
  });

  it("sends a run of clicks as one prompt, in order", async () => {
    const { daemon, send } = await setup();
    const made = ref(
      await send("save-rfp", { groupId: null, name: "Arabic chatbot" }),
    );
    await send("move-rfp", { areaId: made.ref, stage: "lost" });
    await until(() => daemon.prompts.length === 1);
    await wait(40);
    expect(daemon.prompts).toHaveLength(1);
    expect(daemon.prompts[0]).toContain("1. The captain started tracking");
    expect(daemon.prompts[0]).toContain(
      "2. The captain moved the RFP “Arabic chatbot” to lost.",
    );
  });

  it("does not tell Firstmate what it already knows, or about moving around", async () => {
    const { daemon, send } = await setup();
    await send("create-area", {
      groupId: null,
      type: "project",
      name: "Gitex",
      told: true,
    });
    await send("seen");
    await wait(50);
    expect(daemon.prompts).toEqual([]);
  });

  it("does not tell Firstmate about a change Amun refused", async () => {
    const { daemon, send } = await setup();
    const refused = ref(
      await send("move-rfp", { areaId: "nothing-here", stage: "won" }),
    );
    expect(refused.ok).toBe(false);
    await wait(50);
    expect(daemon.prompts).toEqual([]);
  });

  it("keeps what Firstmate says back in that work's conversation", async () => {
    const { daemon, adapter, send } = await setup();
    daemon.reply = "The Presales agent is preparing the loss review.";
    const made = ref(
      await send("save-rfp", { groupId: null, name: "HR assistant" }),
    );
    await until(() => daemon.prompts.length === 1);
    await until(() =>
      daemon.work
        .snapshot()
        .messages.some((message) => message.text === daemon.reply),
    );
    const kept = daemon.work
      .snapshot()
      .messages.find((message) => message.text === daemon.reply)!;
    expect(kept.role).toBe("firstmate");
    expect(kept.workAreaId).toBe(made.ref);
    void adapter;
  });
});

describe("the queue of notes", () => {
  const note = (what: string) => ({ what, card: [], workAreaId: null });

  it("keeps a note until Firstmate has taken it", async () => {
    let up = false;
    const sent: string[] = [];
    const queue = new NoticeQueue(
      async (text) => {
        if (!up) throw new Error("away");
        sent.push(text);
        return "Noted.";
      },
      () => undefined,
      { delayMs: 5, retryMs: 5, keep: null },
    );
    queue.add(note("marked a reminder as done"));
    await wait(30);
    expect(sent).toEqual([]);
    expect(queue.pending).toBe(1);
    up = true;
    await until(() => sent.length === 1);
    expect(queue.pending).toBe(0);
    expect(sent[0]).toContain("The captain marked a reminder as done.");
  });

  it("picks up notes left from before Amun closed", async () => {
    const kept = new Map<string, string>();
    const keep = {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    };
    const first = new NoticeQueue(
      async () => {
        throw new Error("away");
      },
      () => undefined,
      { delayMs: 5, retryMs: 60_000, keep },
    );
    first.add(note("cancelled a reminder"));
    await wait(20);
    const sent: string[] = [];
    const second = new NoticeQueue(
      async (text) => {
        sent.push(text);
        return "Noted.";
      },
      () => undefined,
      { delayMs: 5, keep },
    );
    await until(() => sent.length === 1);
    expect(sent[0]).toContain("The captain cancelled a reminder.");
    expect(second.pending).toBe(0);
  });
});
