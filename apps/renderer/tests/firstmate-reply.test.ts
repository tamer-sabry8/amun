import { expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  event: (_: unknown) => {
    void _;
  },
  turns: 0,
  stale: false,
}));
vi.mock("../src/bridge.ts", () => ({
  bridge: {
    getSnapshot: () => ({ workspace: { preferences: { productId: "p" } } }),
    subscribe: () => () => {},
    onEvent: (f: (e: unknown) => void) => {
      fake.event = f;
      return () => {};
    },
    send: (c: { id: string; command: string }) => {
      if (c.command === "conversation-send" && !fake.stale) fake.turns++;
      // The bounded transcript never changes: it cannot tell turns apart.
      const result = {
        kind: "conversation",
        sessionId: "11111111-1111-4111-8111-111111111111",
        model: "test/model",
        title: "T",
        text: "## Assistant\n\nold",
        omittedItems: 2,
        replyCount: fake.turns,
        ...(fake.turns ? { latestReply: "reply " + fake.turns } : {}),
      };
      queueMicrotask(() =>
        fake.event({ version: 1, kind: "native-pi-result", id: c.id, result }),
      );
    },
  },
}));
it("takes the newest reply from the conversation's own count, never an earlier one", async () => {
  const fm = await import("../src/rebuild/firstmate.ts");
  expect(await fm.askFirstmate("one")).toMatchObject({ reply: "reply 1" });
  expect(await fm.askFirstmate("two")).toMatchObject({ reply: "reply 2" });
  // No new reply arrived: the previous one is not returned again.
  fake.stale = true;
  expect(await fm.askFirstmate("three")).toMatchObject({ ok: false });
});
