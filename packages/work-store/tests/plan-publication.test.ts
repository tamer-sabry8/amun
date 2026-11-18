import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../src/sqlite.ts";
import { migrate } from "../src/database.ts";
import { WorkStore } from "../src/work-store.ts";
import {
  PlanBlocked,
  PlanChanged,
  PlanNotSent,
  PlanPublisher,
  planItemKey,
  sameItem,
  type PlanTarget,
  type PlanWriteItem,
} from "../src/plan-publication.ts";

let db: Database;
let store: WorkStore;
/** A stand-in destination that remembers what it holds, by marker. */
class Remote implements PlanTarget {
  held = new Map<string, string>();
  writes: string[] = [];
  finds: string[] = [];
  /** Per call: "ok", "lost" (written, reply lost), "reject" (not written). */
  script: ("ok" | "lost" | "reject")[] = [];
  blind = false;
  existing?: (
    item: PlanWriteItem,
  ) => Promise<{ externalId: string } | undefined>;
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
  db = openDatabase(":memory:");
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
  items: { summary: string; fields: Record<string, string> }[] = [
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

  it("retries only the failed items of the approved plan, with a fresh budget", async () => {
    const id = approved();
    ado.script = ["reject", "reject"];
    await publisher.publish(id);
    expect(plan(id).state).toBe("partial");
    const marker = publisher.writes(id)[0]!;
    await publisher.publish(id, { retryFailed: true });
    expect(ado.writes).toEqual([
      "Sample story",
      "Sample story",
      "Sample story",
    ]);
    expect(notion.writes).toEqual(["Sample page"]);
    expect(ado.finds).toContain("Sample story");
    expect(plan(id).state).toBe("published");
    expect(publisher.writes(id)[0]).toMatchObject({
      id: marker.id,
      state: "created",
    });
    expect(
      store.snapshot().attention.find((item) => item.ref === "failure:" + id),
    ).toMatchObject({ state: "done" });
  });

  it("links an item that was created in the meantime instead of creating it again", async () => {
    const id = approved([{ summary: "Sample story", fields: {} }]);
    ado.script = ["reject", "reject"];
    await publisher.publish(id);
    const row = db
      .prepare("SELECT marker FROM plan_writes WHERE plan_id=?")
      .get(id) as { marker: string };
    ado.held.set(row.marker, "777");
    await publisher.publish(id, { retryFailed: true });
    expect(ado.writes).toHaveLength(2);
    expect(plan(id).state).toBe("published");
    expect(plan(id).results[0]).toMatchObject({
      state: "created",
      externalId: "777",
    });
  });

  it("does not touch an item still being checked when retrying failures", async () => {
    const id = approved();
    ado.script = ["reject", "reject"];
    notion.script = ["lost"];
    notion.blind = true;
    await publisher.publish(id);
    expect(plan(id).results.map((result) => result.state)).toEqual([
      "failed",
      "unknown",
    ]);
    notion.blind = false;
    await publisher.publish(id, { retryFailed: true });
    expect(notion.finds).toHaveLength(1);
    expect(notion.writes).toHaveLength(1);
    expect(plan(id).results.map((result) => result.state)).toEqual([
      "created",
      "unknown",
    ]);
  });

  it("sends nothing and asks for a new review when the plan changed after approval", async () => {
    const id = approved([{ summary: "Sample story", fields: {} }]);
    ado.script = ["reject", "reject"];
    await publisher.publish(id);
    expect(publisher.needsReview(id)).toBe(false);
    send("update-plan", {
      planId: id,
      items: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          summary: "Sample story",
          fields: { title: "Changed" },
        },
      ],
    });
    expect(publisher.needsReview(id)).toBe(true);
    await publisher.publish(id, { retryFailed: true });
    expect(ado.writes).toHaveLength(2);
    expect(plan(id).state).toBe("proposed");
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

describe("a refusal from the destination", () => {
  it("is recorded as not created with its reason, never as being checked", async () => {
    const { PlanRefused } = await import("../src/plan-publication.ts");
    const id = approved([{ summary: "Sample story", fields: {} }]);
    let calls = 0;
    const refusing = new PlanPublisher(db, store, async () => ({
      async write() {
        calls++;
        throw new PlanRefused(
          "Azure DevOps refused it: TF401320 Remaining Work is required",
        );
      },
      async find() {
        throw Error("lookup must not run");
      },
    }));
    await refusing.publish(id);
    expect(calls).toBe(1);
    expect(plan(id).results[0]!.state).toBe("failed");
    expect(refusing.writes(id)[0]).toMatchObject({
      note: expect.stringContaining("TF401320"),
    });
  });
});

describe("an item left being checked after a definite refusal", () => {
  const refusal =
    "Azure DevOps refused it: TF401320: Rule Error for field Remaining Work.";
  const stuck = async () => {
    const id = approved([{ summary: "Sample story", fields: {} }]);
    ado.script = ["lost"];
    ado.blind = true;
    await publisher.publish(id);
    expect(plan(id).results[0]!.state).toBe("unknown");
    db.prepare("UPDATE plan_writes SET note=? WHERE plan_id=?").run(
      refusal,
      id,
    );
    ado.held.clear();
    return id;
  };
  it("becomes not created with the stored reason when the lookup finds nothing", async () => {
    const id = await stuck();
    ado.blind = false;
    await publisher.publish(id, { reconcileOnly: true });
    expect(plan(id).results[0]!.state).toBe("failed");
    expect(publisher.uncertain()).toEqual([]);
    expect(publisher.writes(id)[0]!.note).toBe(refusal);
    expect(ado.writes).toHaveLength(1);
  });
  it("does not loop when the lookup itself fails", async () => {
    const id = await stuck();
    await publisher.publish(id, { reconcileOnly: true });
    expect(plan(id).results[0]!.state).toBe("failed");
    expect(publisher.writes(id)[0]!.note).toBe(refusal);
  });
  it("still links the item if the lookup finds it", async () => {
    const id = approved([{ summary: "Sample story", fields: {} }]);
    ado.script = ["lost"];
    ado.blind = true;
    await publisher.publish(id);
    db.prepare("UPDATE plan_writes SET note=? WHERE plan_id=?").run(
      refusal,
      id,
    );
    ado.blind = false;
    await publisher.publish(id, { reconcileOnly: true });
    expect(plan(id).results[0]!.state).toBe("created");
  });
  it("becomes not created when the destination would refuse the item, without sending", async () => {
    const id = approved([{ summary: "Sample story", fields: {} }]);
    ado.script = ["lost"];
    ado.blind = true;
    await publisher.publish(id);
    const reason = "“Remaining Work” is required before this can be sent.";
    const rejecting = new PlanPublisher(db, store, async () => ({
      async write() {
        throw Error("write must not run");
      },
      async find() {
        throw new PlanNotSent(reason);
      },
    }));
    await rejecting.publish(id, { reconcileOnly: true });
    expect(plan(id).results[0]!.state).toBe("failed");
    expect(rejecting.uncertain()).toEqual([]);
    expect(rejecting.writes(id)[0]!.note).toBe(reason);
    expect(ado.writes).toHaveLength(1);
  });
  it("keeps an item uncertain when the stored error is not a definite refusal", async () => {
    const id = approved([{ summary: "Sample story", fields: {} }]);
    ado.script = ["lost"];
    ado.blind = true;
    await publisher.publish(id);
    await publisher.publish(id, { reconcileOnly: true });
    expect(plan(id).results[0]!.state).toBe("unknown");
  });
});

describe("approving only some items", () => {
  it("approves and publishes the ticked item and leaves the other waiting", async () => {
    const proposed = send("propose-plan", {
      groupId: null,
      workAreaId: null,
      planKind: "stories",
      destination: "ado",
      summary: "Pilot sample",
      items: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          summary: "Sample story",
          fields: {},
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          summary: "Sample page",
          fields: { destination: "notion" },
        },
      ],
    });
    const id = proposed.ref!;
    const approved = send("approve-plan", {
      planId: id,
      fingerprint: plan(id).fingerprint,
      itemIds: ["00000000-0000-4000-8000-000000000001"],
    });
    expect(approved.ok).toBe(true);
    await publisher.publish(id);
    expect(ado.writes).toEqual(["Sample story"]);
    expect(notion.writes).toEqual([]);
    expect(plan(id).state).toBe("published");
    const waiting = store
      .snapshot()
      .plans.find((entry) => entry.splitFrom === id)!;
    expect(waiting).toMatchObject({ state: "proposed", destination: "ado" });
    expect(waiting.items.map((item) => item.summary)).toEqual(["Sample page"]);
    expect(
      store
        .snapshot()
        .attention.some((item) => item.ref === "plan:" + waiting.id),
    ).toBe(true);
    // The waiting item is approved later on its own and only then sent.
    send("approve-plan", {
      planId: waiting.id,
      fingerprint: waiting.fingerprint,
    });
    await publisher.publish(waiting.id);
    expect(notion.writes).toEqual(["Sample page"]);
  });

  it("refuses an item that is not in the plan", () => {
    const proposed = send("propose-plan", {
      groupId: null,
      workAreaId: null,
      planKind: "stories",
      destination: "ado",
      summary: "",
      items: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          summary: "Only item",
          fields: {},
        },
      ],
    });
    const result = send("approve-plan", {
      planId: proposed.ref!,
      fingerprint: plan(proposed.ref!).fingerprint,
      itemIds: ["00000000-0000-4000-8000-000000000009"],
    });
    expect(result.ok).toBe(false);
    expect(plan(proposed.ref!).state).toBe("proposed");
  });
});

describe("a second plan for something already published", () => {
  const story = [{ summary: "Admin picks the invitee role", fields: {} }];
  const again = [
    {
      summary: "  admin picks the  INVITEE role ",
      fields: { type: "User Story" },
    },
  ];

  it("links to the item Amun's own receipt names and creates nothing", async () => {
    await publisher.publish(approved(story));
    const second = approved(again);
    await publisher.publish(second);
    expect(ado.writes).toEqual(["Admin picks the invitee role"]);
    expect(plan(second).state).toBe("published");
    expect(plan(second).results).toEqual([
      expect.objectContaining({
        state: "created",
        externalId: "100",
        linked: true,
      }),
    ]);
    expect(
      store
        .snapshot()
        .activity.some((row) => row.text.startsWith("Already exists: #100")),
    ).toBe(true);
  });

  it("asks the destination when no receipt is held, and still creates nothing", async () => {
    ado.existing = async () => ({ externalId: "1091018" });
    const id = approved(story);
    await publisher.publish(id);
    expect(ado.writes).toEqual([]);
    expect(plan(id).results).toEqual([
      expect.objectContaining({ externalId: "1091018", linked: true }),
    ]);
  });

  it("creates nothing when the check itself fails", async () => {
    ado.existing = async () => {
      throw Error("offline");
    };
    const id = approved(story);
    await publisher.publish(id);
    expect(ado.writes).toEqual([]);
    expect(plan(id).results).toEqual([
      expect.objectContaining({ state: "failed" }),
    ]);
  });

  it("shows a check that cannot fit the item as its own reason, not as an unchecked item", async () => {
    ado.existing = async () => {
      throw new PlanNotSent(
        "Task in POCs has no Acceptance criteria or Description field, so it would be lost.",
      );
    };
    const id = approved(story);
    await publisher.publish(id);
    expect(ado.writes).toEqual([]);
    const note = publisher.writes(id)[0]!.note!;
    expect(note).toMatch(/^Task in POCs has no Acceptance criteria/);
    expect(note).not.toMatch(/Could not check/);
  });

  it("still creates a different title, and says before approval what exists", async () => {
    await publisher.publish(approved(story));
    const other = approved([
      { summary: "Admin removes an invitee", fields: {} },
    ]);
    await publisher.publish(other);
    expect(ado.writes).toHaveLength(2);
    const item = { ...story[0]!, id: "x" };
    expect(await publisher.alreadyThere(other, item, "ado")).toEqual(
      expect.objectContaining({ externalId: "100", linked: true }),
    );
    expect(
      await publisher.alreadyThere(
        other,
        { ...item, summary: "Something new" },
        "ado",
      ),
    ).toBeUndefined();
  });
});

describe("updating a Notion page Amun created", () => {
  const pageId = "11111111-2222-4333-8444-555555555555";
  const propose = (fields: Record<string, string>) => {
    const id = send("propose-plan", {
      groupId: null,
      workAreaId: null,
      planKind: "edit",
      destination: "notion",
      summary: "Update Notion page: QA notes",
      items: [
        {
          id: "00000000-0000-4000-8000-0000000000a1",
          summary: "Update Notion page: QA notes",
          fields,
        },
      ],
    }).ref!;
    send("approve-plan", { planId: id, fingerprint: plan(id).fingerprint });
    return id;
  };
  const publisherFor = (target: PlanTarget) =>
    new PlanPublisher(db, store, async () => target);

  it("keeps the version and the text written, and knows only its own pages", async () => {
    const first = propose({ title: "QA notes", body: "Hello" });
    await publisherFor({
      write: async () => ({ externalId: pageId, version: "v1" }),
      find: async () => undefined,
    }).publish(first);
    const receipt = publisher.notionPage(pageId.toUpperCase());
    expect(receipt).toMatchObject({
      version: "v1",
      title: "QA notes",
      body: "Hello",
    });
    expect(publisher.notionPage("99999999-2222-4333-8444-555555555555")).toBe(
      undefined,
    );
  });

  it("records an update with its new version", async () => {
    await publisherFor({
      write: async () => ({ externalId: pageId, version: "v1" }),
      find: async () => undefined,
    }).publish(propose({ title: "QA notes", body: "Hello" }));
    const second = propose({ page: pageId, title: "QA notes", body: "Hi" });
    await publisherFor({
      write: async () => ({
        externalId: pageId,
        updated: true,
        version: "v2",
      }),
      find: async () => undefined,
    }).publish(second);
    expect(plan(second).state).toBe("published");
    expect(plan(second).results[0]).toMatchObject({ updated: true });
    expect(publisher.notionPage(pageId)).toMatchObject({
      version: "v2",
      body: "Hi",
    });
  });

  it("stops on a page changed in Notion: nothing written, the newer page is linked", async () => {
    const changed = propose({ page: pageId, title: "QA notes", body: "Hi" });
    let writes = 0;
    await publisherFor({
      write: async () => {
        writes++;
        throw new PlanChanged("Changed in Notion", "https://notion.example/p");
      },
      find: async () => undefined,
    }).publish(changed);
    expect(plan(changed).state).toBe("failed");
    expect(publisher.writes(changed)[0]).toMatchObject({
      state: "missing",
      note: "Changed in Notion",
      url: "https://notion.example/p",
    });
    expect(writes).toBeLessThanOrEqual(2);
  });
});

describe("retrying a plan whose story another plan already published", () => {
  it("links it instead of creating a third copy, and clears the failure", async () => {
    const old = approved([
      {
        summary: "Admin picks the invitee role",
        fields: { type: "User Story" },
      },
    ]);
    ado.script = ["reject", "reject"];
    await publisher.publish(old);
    expect(plan(old).state).toBe("failed");
    expect(ado.writes).toHaveLength(2);

    // Another plan created the same story under the project's own type.
    const other = approved([
      {
        summary: "Admin picks the invitee role",
        fields: { type: "Product Backlog Item" },
      },
    ]);
    await publisher.publish(other);
    expect(ado.writes).toHaveLength(3);
    const created = plan(other).results[0]!.externalId;

    await publisher.publish(old, { retryFailed: true });
    expect(ado.writes).toHaveLength(3);
    expect(plan(old).state).toBe("published");
    expect(plan(old).results).toEqual([
      expect.objectContaining({ externalId: created, linked: true }),
    ]);
  });

  it("clears the failure on its own when the same story was published elsewhere", async () => {
    const old = approved([
      {
        summary: "Admin picks the invitee role",
        fields: { type: "User Story" },
      },
    ]);
    ado.script = ["reject", "reject"];
    await publisher.publish(old);
    await publisher.publish(
      approved([
        {
          summary: "Admin picks the invitee role",
          fields: { type: "Product Backlog Item" },
        },
      ]),
    );
    expect(plan(old).state).toBe("published");
    expect(
      store
        .snapshot()
        .attention.some(
          (row) => row.ref === "failure:" + old && row.state !== "done",
        ),
    ).toBe(false);
  });

  it("creates nothing on a retry when the check cannot be made", async () => {
    const old = approved([{ summary: "Another story", fields: {} }]);
    ado.script = ["reject", "reject"];
    await publisher.publish(old);
    ado.existing = async () => {
      throw Error("offline");
    };
    await publisher.publish(old, { retryFailed: true });
    expect(ado.writes).toHaveLength(2);
  });
});

describe("parent links in the duplicate guard", () => {
  const key = (parent: string) =>
    planItemKey({
      id: "i",
      summary: "QA task",
      fields: { type: "Task", Parent: parent },
      marker: "m",
      destination: "ado",
    } as never);
  it("treats the same title and kind under the same parent as one item", () => {
    expect(sameItem(key("1091018"), key("1091018"))).toBe(true);
    expect(sameItem(key("1091018"), key("1091019"))).toBe(false);
  });
});

describe("duplicate check failure reason", () => {
  it("names the known causes in plain words and hides links and secrets", async () => {
    const { duplicateCheckReason, redactedError } =
      await import("../src/plan-publication.ts");
    expect(duplicateCheckReason(new Error("request_rejected_400"))).toBe(
      "Azure DevOps answered 400 to the search",
    );
    expect(duplicateCheckReason(new Error("request_rejected_401"))).toMatch(
      /connection/,
    );
    expect(
      duplicateCheckReason(new Error("Azure item identity mismatch")),
    ).toMatch(/different project/);
    expect(duplicateCheckReason(new Error("fetch failed"))).toMatch(/reached/);
    expect(duplicateCheckReason(new Error("boom"))).toBe("");
    expect(
      redactedError(new Error("GET https://u:pw@host/x failed token abc123")),
    ).not.toMatch(/pw@|abc123|https/);
  });
});

it("shows the destination's own refusal text on the card", async () => {
  const { refusalReason } = await import("../src/plan-publication.ts");
  const error = Object.assign(Error("request_rejected_400"), {
    detail: "TF401320: Rule Error",
  });
  expect(refusalReason("ado", error)).toBe(
    "Azure DevOps refused it: TF401320: Rule Error",
  );
});
