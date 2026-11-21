import { expect, it, vi } from "vitest";
import { NavigationQueue } from "../src/daemon/navigation.ts";

it("preserves each click and its exact reference across a bookkeeping failure and restart", async () => {
  const db = new Map<string, string>();
  const keep = {
    getItem: (key: string) => db.get(key) ?? null,
    setItem: (key: string, value: string) => {
      db.set(key, value);
    },
  };
  const sent: string[] = [];
  const send = async (text: string) => {
    sent.push(text);
  };
  const first = new NavigationQueue(
    {
      send,
      activity: async (_, state) => {
        if (state === "finished") throw Error("offline");
      },
    },
    keep,
  );
  first.add({ view: "Backlog", areaId: "gitex" });
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  const resumed = new NavigationQueue({ send, activity: async () => {} }, keep);
  await resumed.flush();
  expect(sent).toHaveLength(1);
  resumed.add({ view: "Backlog", areaId: "gitex" });
  await vi.waitFor(() => expect(sent).toHaveLength(2));
  expect(sent[0]).not.toEqual(sent[1]);
  expect(sent.every((text) => text.includes("gitex"))).toBe(true);
});
