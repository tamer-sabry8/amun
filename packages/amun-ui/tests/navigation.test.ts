import { expect, it, vi } from "vitest";
import { NavigationQueue } from "../src/daemon/navigation.ts";

function memoryStorage() {
  const db = new Map<string, string>();
  return {
    db,
    keep: {
      getItem: (key: string) => db.get(key) ?? null,
      setItem: (key: string, value: string) => {
        db.set(key, value);
      },
    },
  };
}

it("plain view open completes Activity with 0 send calls", async () => {
  const { db, keep } = memoryStorage();
  const sent: string[] = [];
  const states: { ref: string; state: string }[] = [];
  const queue = new NavigationQueue(
    {
      send: async (text) => {
        sent.push(text);
      },
      activity: async (item, state) => {
        states.push({ ref: item.ref, state });
      },
    },
    keep,
  );
  queue.add({ view: "Backlog", areaId: "gitex" });
  await vi.waitFor(() => expect(states).toHaveLength(1));
  expect(sent).toHaveLength(0);
  expect(states[0]?.state).toBe("finished");
  expect(JSON.parse(db.get("amun.navigation.v1") ?? "[]")).toEqual([]);
});

it("pre-upgrade persisted passive item completes Activity with 0 send calls", async () => {
  const { db, keep } = memoryStorage();
  const ref = "amun-r-0123456789ab";
  db.set(
    "amun.navigation.v1",
    JSON.stringify([
      {
        ref,
        inspection: { view: "Backlog", areaId: "gitex" },
        prompt: `Open Backlog. Show the selected view.\nRequest ${ref}`,
        delivered: false,
      },
    ]),
  );
  const sent: string[] = [];
  const states: { ref: string; state: string }[] = [];
  const queue = new NavigationQueue(
    {
      send: async (text) => {
        sent.push(text);
      },
      activity: async (item, state) => {
        states.push({ ref: item.ref, state });
      },
    },
    keep,
  );
  await queue.flush();
  expect(sent).toHaveLength(0);
  expect(states).toEqual([{ ref, state: "finished" }]);
  expect(JSON.parse(db.get("amun.navigation.v1") ?? "[]")).toEqual([]);
});

it("transient Activity failure keeps the passive item queued until Activity persists", async () => {
  const { db, keep } = memoryStorage();
  const sent: string[] = [];
  const states: { ref: string; state: string }[] = [];
  let failOnce = true;
  const queue = new NavigationQueue(
    {
      send: async (text) => {
        sent.push(text);
      },
      activity: async (item, state) => {
        if (failOnce) {
          failOnce = false;
          throw Error("offline");
        }
        states.push({ ref: item.ref, state });
      },
    },
    keep,
  );
  queue.add({ view: "Sprints", areaId: "gitex" });
  await vi.waitFor(() =>
    expect(JSON.parse(db.get("amun.navigation.v1") ?? "[]")).toHaveLength(1),
  );
  expect(sent).toHaveLength(0);
  expect(states).toHaveLength(0);

  await queue.flush();
  expect(sent).toHaveLength(0);
  expect(states).toHaveLength(1);
  expect(states[0]?.state).toBe("finished");
  expect(JSON.parse(db.get("amun.navigation.v1") ?? "[]")).toEqual([]);
});

it("submitted inspection.search retains its request reference and sends once across a bookkeeping failure and restart", async () => {
  const { keep } = memoryStorage();
  const sent: { text: string; ref: string }[] = [];
  const states: { ref: string; state: string }[] = [];
  const send = async (text: string, ref: string) => {
    sent.push({ text, ref });
  };
  const first = new NavigationQueue(
    {
      send,
      activity: async (item, state) => {
        states.push({ ref: item.ref, state });
        if (state === "finished") throw Error("offline");
      },
    },
    keep,
  );
  const search = { query: "billing", details: true, backlog: "POCs" };
  first.add({ view: "Backlog", areaId: "gitex", search });
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  const resumed = new NavigationQueue(
    {
      send,
      activity: async (item, state) => {
        states.push({ ref: item.ref, state });
      },
    },
    keep,
  );
  await resumed.flush();
  expect(sent).toHaveLength(1);
  expect(sent[0]!.text).toContain(sent[0]!.ref);
  expect(sent[0]!.text).toContain("billing");
  expect(states.at(-1)).toEqual({ ref: sent[0]!.ref, state: "finished" });

  resumed.add({ view: "Backlog", areaId: "gitex", search });
  await vi.waitFor(() => expect(sent).toHaveLength(2));
  expect(sent[0]!.ref).not.toEqual(sent[1]!.ref);
  expect(sent.every((entry) => entry.text.includes("gitex"))).toBe(true);
});

it("marks Activity finished when an explicit search returns delivered=false", async () => {
  const { db, keep } = memoryStorage();
  const states: string[] = [];
  const queue = new NavigationQueue(
    {
      send: async () => false,
      activity: async (_, state) => {
        states.push(state);
      },
    },
    keep,
  );
  queue.add({
    view: "Backlog",
    areaId: "gitex",
    search: { query: "auth", details: false, backlog: "POCs" },
  });
  await vi.waitFor(() => expect(states).toEqual(["running", "finished"]));
  expect(JSON.parse(db.get("amun.navigation.v1") ?? "[]")).toEqual([]);
});
