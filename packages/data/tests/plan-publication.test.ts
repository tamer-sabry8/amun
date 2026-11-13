import { beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "../src/database.ts";
import { WorkStore } from "../src/work-store.ts";
import {
  PlanBlocked,
  PlanPublisher,
  type PlanTarget,
  type PlanWriteItem,
} from "../src/plan-publication.ts";

let db: Database.Database;
let store: WorkStore;
/** A stand-in destination that remembers what it holds, by marker. */
class Remote implements PlanTarget {
  held = new Map<string, string>();
  writes: string[] = [];
  finds: string[] = [];
  /** Per call: "ok", "lost" (written, reply lost), "reject" (not written). */
  script: ("ok" | "lost" | "reject")[] = [];
  blind = false;
  private next = 100;
  constructor(private readonly prefix: string) {}
  async write(item: PlanWriteItem) {
    this.writes.push(item.summary);
    const step = this.script.shift() ?? "ok";
    if (step === "reject") throw Error("request_rejected_500");
    const id = String(this.next++);
    this.held.set(item.marker, id);
    if (step === "lost") throw Error("socket hang up");
    return { externalId: id, url: this.prefix + id };
  }
  async find(item: PlanWriteItem) {
    this.finds.push(item.summary);
    if (this.blind) throw Error("offline");
    const id = this.held.get(item.marker);
    return id ? { externalId: id, url: this.prefix + id } : undefined;
  }
}
let ado: Remote;
let notion: Remote;
let publisher: PlanPublisher;
const send = (action: string, extra: Record<string, unknown> = {}) => {
  const events = store.handle({ version: 1, kind: "work", action, ...extra });
  return events.find((event) => event.kind === "work-result") as {
    ok: boolean;
    ref: string | null;
    message: string;
  };
};
const plan = (id: string) =>
  store.snapshot().plans.find((entry) => entry.id === id)!;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  store = new WorkStore(db);
  ado = new Remote("https://ado.example/_workitems/edit/");
  notion = new Remote("https://notion.example/");
  publisher = new PlanPublisher(db, store, async (destination) => {
    if (destination === "ado") return ado;
    if (destination === "notion") return notion;
    throw new PlanBlocked(destination + " is not connected.");
  });
});

function approved(
  items = [
    { summary: "Sample story", fields: {} },
    { summary: "Sample page", fields: { destination: "notion" } },
  ],
) {
  const proposed = send("propose-plan", {
    groupId: null,
    workAreaId: null,
    planKind: "stories",
    destination: "ado",
    summary: "Pilot sample",
    items: items.map((item, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index + 1}`,
      ...item,
    })),
  });
  const id = proposed.ref!;
  expect(
    send("approve-plan", { planId: id, fingerprint: plan(id).fingerprint }).ok,
  ).toBe(true);
  return id;
}

describe("publishing an approved plan", () => {
  it("writes each item to its own destination under one approval", async () => {
    const id = approved();
    await publisher.publish(id);
    expect(ado.writes).toEqual(["Sample story"]);
    expect(notion.writes).toEqual(["Sample page"]);
    const result = plan(id);
    expect(result.state).toBe("published");
    expect(result.results).toEqual([
      expect.objectContaining({
        state: "created",
        externalId: "100",
        url: "https://ado.example/_workitems/edit/100",
      }),
      expect.objectContaining({
        state: "created",
        url: "https://notion.example/100",
      }),
    ]);
  });

  it("does nothing for a plan that was not approved", async () => {
    const proposed = send("propose-plan", {
      groupId: null,
      workAreaId: null,
      planKind: "stories",
      destination: "ado",
      summary: "",
      items: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          summary: "Unapproved",
          fields: {},
        },
      ],
    });
    await publisher.publish(proposed.ref!);
    expect(ado.writes).toEqual([]);
    expect(plan(proposed.ref!).state).toBe("proposed");
  });

  it("links an uncertain write that did land, without writing again", async () => {
    const id = approved([{ summary: "Sample story", fields: {} }]);
    ado.script = ["lost"];
    await publisher.publish(id);
    expect(ado.writes).toHaveLength(1);
    expect(ado.held.size).toBe(1);
    expect(plan(id).state).toBe("published");
    expect(plan(id).results[0]).toMatchObject({
      state: "created",
      externalId: "100",
    });
  });

  it("retries once, only the item confirmed missing", async () => {
    const id = approved();
    ado.script = ["reject"];
    await publisher.publish(id);
    expect(ado.writes).toEqual(["Sample story", "Sample story"]);
    expect(notion.writes).toEqual(["Sample page"]);
    expect(ado.held.size).toBe(1);
    expect(plan(id).state).toBe("published");
  });

  it("stops at the retry budget and reports the item as not created", async () => {
    const id = approved();
    ado.script = ["reject", "reject"];
    await publisher.publish(id);
    expect(ado.writes).toHaveLength(2);
    expect(plan(id).state).toBe("partial");
    expect(plan(id).results.map((result) => result.state)).toEqual([
      "failed",
      "created",
    ]);
    // Asking again does not send it a third time.
    await publisher.publish(id);
    expect(ado.writes).toHaveLength(2);
    expect(notion.writes).toHaveLength(1);
  });

  it("asks instead of resending while the outcome cannot be established", async () => {
    const id = approved([{ summary: "Sample story", fields: {} }]);
    ado.script = ["lost"];
    ado.blind = true;
    await publisher.publish(id);
    expect(ado.writes).toHaveLength(1);
    expect(plan(id).results[0]!.state).toBe("unknown");
    expect(publisher.uncertain()).toEqual([id]);
    const open = store
      .snapshot()
      .attention.find((item) => item.ref === "failure:" + id);
    expect(open?.options).toEqual(["Check what was created"]);
    // Once the destination answers, the existing item is linked.
    ado.blind = false;
    await publisher.publish(id, { reconcileOnly: true });
    expect(ado.writes).toHaveLength(1);
    expect(plan(id).state).toBe("published");
    expect(publisher.uncertain()).toEqual([]);
  });

  it("sends nothing when the destination is not connected", async () => {
    const id = approved([
      { summary: "Jira card", fields: { destination: "jira" } },
    ]);
    await publisher.publish(id);
    expect(plan(id).state).toBe("failed");
    expect(publisher.writes(id)[0]).toMatchObject({
      state: "pending",
      attempts: 0,
      note: "jira is not connected.",
    });
  });

  it("keeps one marker per item across attempts and restarts", async () => {
    const id = approved([{ summary: "Sample story", fields: {} }]);
    ado.script = ["lost"];
    ado.blind = true;
    await publisher.publish(id);
    const marker = [...ado.held.keys()][0];
    ado.blind = false;
    const restarted = new PlanPublisher(db, store, async () => ado);
    await restarted.publish(id);
    expect([...ado.held.keys()]).toEqual([marker]);
    expect(plan(id).state).toBe("published");
  });

  it("runs one publication at a time per plan", async () => {
    const id = approved([{ summary: "Sample story", fields: {} }]);
    await Promise.all([publisher.publish(id), publisher.publish(id)]);
    expect(ado.writes).toHaveLength(1);
  });
});

describe("a write that never left the Mac", () => {
  it("is retried without a lookup and then reported as not created", async () => {
    const { PlanNotSent } = await import("../src/plan-publication.ts");
    const id = approved([{ summary: "Sample story", fields: {} }]);
    let calls = 0;
    const offline = new PlanPublisher(db, store, async () => ({
      async write() {
        calls++;
        throw new PlanNotSent("Reconnect Notion");
      },
      async find() {
        throw Error("lookup must not run");
      },
    }));
    await offline.publish(id);
    expect(calls).toBe(2);
    expect(plan(id).results[0]!.state).toBe("failed");
    expect(offline.writes(id)[0]).toMatchObject({ note: "Reconnect Notion" });
  });
});
