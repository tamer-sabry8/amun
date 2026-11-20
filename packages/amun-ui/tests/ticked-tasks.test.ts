import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tickedTasks } from "../src/rebuild/ticked-tasks.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a ticked Firstmate task", () => {
  it("is sent after the Undo time and shown for 20 seconds", () => {
    const sent: string[] = [];
    const store = tickedTasks((id) => sent.push(id));
    store.tick("hold:a");
    store.tick("hold:a");
    expect(store.get()["hold:a"]).toMatchObject({ sent: false });
    vi.advanceTimersByTime(5_000);
    expect(sent).toEqual(["hold:a"]);
    expect(store.get()["hold:a"]).toMatchObject({ sent: true });
    // Too late to undo once sent.
    store.undo("hold:a");
    expect(store.get()["hold:a"]).toBeDefined();
    vi.advanceTimersByTime(15_000);
    expect(store.get()["hold:a"]).toBeUndefined();
    expect(sent).toEqual(["hold:a"]);
  });

  it("sends nothing when undone in time", () => {
    const sent: string[] = [];
    const store = tickedTasks((id) => sent.push(id));
    store.tick("hold:b");
    vi.advanceTimersByTime(2_000);
    store.undo("hold:b");
    vi.advanceTimersByTime(30_000);
    expect(sent).toEqual([]);
    expect(store.get()).toEqual({});
  });
});
