import { expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  product: "one" as string | null,
  update: () => {},
  event: (_: unknown) => {
    void _;
  },
  sent: [] as { command: string; argument: string }[],
  failure: "",
  silentStart: false,
}));
vi.mock("../src/bridge.ts", () => ({
  bridge: {
    getSnapshot: () => ({
      workspace: { preferences: { productId: fake.product } },
    }),
    subscribe: (f: () => void) => {
      fake.update = f;
      return () => {};
    },
    onEvent: (f: (e: unknown) => void) => {
      fake.event = f;
      return () => {};
    },
    send: (c: { id: string; command: string; argument: string }) => {
      fake.sent.push(c);
      if (fake.silentStart && c.command === "conversation") return;
      const result =
        c.command === "conversation-send" && fake.failure
          ? { kind: "message", text: fake.failure }
          : {
              kind: "conversation",
              sessionId:
                fake.product === "one"
                  ? "11111111-1111-4111-8111-111111111111"
                  : "22222222-2222-4222-8222-222222222222",
              model: "test/model",
              title: "Test",
              text:
                c.command === "conversation-send"
                  ? "User: Hello\n\nAssistant: Hi"
                  : "",
              omittedItems: 0,
            };
      queueMicrotask(() =>
        fake.event({ version: 1, kind: "native-pi-result", id: c.id, result }),
      );
    },
  },
}));
it("reopens the product session after selection and does not mistake an uncertain turn for missing credentials", async () => {
  const fm = await import("../src/rebuild/firstmate.ts");
  await fm.askFirstmate("Hello");
  fm.markBriefed();
  expect(fm.needsBriefing()).toBe(false);
  fake.product = "two";
  fake.update();
  expect(fm.needsBriefing()).toBe(true);
  fake.failure =
    "Turn outcome could not be verified. Read the conversation before sending another message.";
  const reply = await fm.askFirstmate("Hello");
  expect(fake.sent.map((c) => c.command)).toEqual([
    "conversation",
    "conversation-send",
    "conversation",
    "conversation-send",
  ]);
  expect(JSON.parse(fake.sent[3]!.argument).sessionId).toBe(
    "22222222-2222-4222-8222-222222222222",
  );
  expect(reply).toMatchObject({ ok: false, needsProvider: false });
});

it("a remounted queue observer sees a prior turn clear its waiting message", async () => {
  const fm = await import("../src/rebuild/firstmate.ts");
  const seen: (string | null)[] = [];
  fm.holdMessage("gitex", { text: "second", scoped: "second", reason: "busy" });
  const stop = fm.observeHeldMessages(() =>
    seen.push(fm.heldMessage("gitex")?.text ?? null),
  );
  fm.releaseMessage("gitex");
  stop();
  expect(seen).toEqual([null]);
});

it("reports a silent chat start and keeps the user's turn out of the delivery queue", async () => {
  vi.useFakeTimers();
  try {
    vi.resetModules();
    fake.sent.length = 0;
    fake.silentStart = true;
    const fm = await import("../src/rebuild/firstmate.ts");
    const reply = fm.askFirstmate("Create a project");
    await vi.advanceTimersByTimeAsync(60_001);
    expect(await reply).toMatchObject({
      ok: false,
      needsProvider: false,
      reason: expect.stringContaining("opening the conversation"),
    });
    expect(fake.sent.map((c) => c.command)).toEqual(["conversation"]);
  } finally {
    fake.silentStart = false;
    vi.useRealTimers();
  }
});

it("retains every follow-up while a provider-blocked head waits again", async () => {
  const fm = await import("../src/rebuild/firstmate.ts");
  for (const text of ["one", "two", "three"])
    fm.holdMessage("queue", { text, scoped: text });
  const head = fm.releaseMessage("queue")!;
  fm.holdMessage("queue", { ...head, reason: "provider" }, true);
  expect(
    Array.from({ length: 4 }, () => fm.releaseMessage("queue")?.text),
  ).toEqual(["one", "two", "three", undefined]);
});
