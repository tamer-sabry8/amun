import { expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  product: "one" as string | null,
  update: () => {},
  event: (_: unknown) => {
    void _;
  },
  sent: [] as { id: string; command: string; argument: string }[],
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
    },
  },
}));
const reply = (id: string, result: object) =>
  fake.event({ version: 1, kind: "native-pi-result", id, result });
const conversation = (sessionId: string, model: string, text = "") => ({
  kind: "conversation",
  sessionId,
  model,
  title: "Test",
  text,
  omittedItems: 0,
});
const one = "11111111-1111-4111-8111-111111111111";
const two = "22222222-2222-4222-8222-222222222222";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

it("settles an outstanding prime on a context switch and primes the new context", async () => {
  const fm = await import("../src/rebuild/firstmate.ts");
  const models = fm.listModels();
  await tick();
  const stale = fake.sent[0]!;
  expect(stale.command).toBe("conversation");
  fake.product = "two";
  fake.update();
  // The old prime is released and a new one starts for the new context.
  await expect(models).resolves.toEqual([]);
  await tick();
  const fresh = fake.sent.at(-1)!;
  expect(fresh.id).not.toBe(stale.id);
  reply(stale.id, conversation(one, "github-copilot/old"));
  expect(fm.currentModel()).toBeNull();
  reply(fresh.id, conversation(two, "github-copilot/claude-sonnet-5.5"));
  await tick();
  expect(fm.currentModel()).toBe("github-copilot/claude-sonnet-5.5");
});

it("keeps the answer to a turn sent before a switch, without resending it or replacing the new context", async () => {
  const fm = await import("../src/rebuild/firstmate.ts");
  const before = fake.sent.length;
  const turn = fm.askFirstmate("Rename this to Invoiced");
  await tick();
  expect(fake.sent.length).toBe(before + 1);
  expect(fake.sent.at(-1)!.command).toBe("conversation-send");
  // The captain opens another product's chat while Firstmate is answering.
  fake.product = "one";
  fake.update();
  await tick();
  // Only the new context's prime was sent: the turn was not resent.
  const after = fake.sent.slice(before).map((c) => c.command);
  expect(after).toEqual(["conversation-send", "conversation"]);
  const stale = fake.sent[before]!;
  reply(stale.id, {
    ...conversation(two, "github-copilot/old", "Assistant: done"),
    latestReply: 'Done.\n```amun\n{"do":"rename","name":"Invoiced"}\n```',
  });
  // The answer still reaches the chat that sent it, rename included.
  await expect(turn).resolves.toMatchObject({
    ok: true,
    reply: 'Done.\n```amun\n{"do":"rename","name":"Invoiced"}\n```',
  });
  // It never becomes the new context's conversation.
  expect(fm.currentModel()).toBeNull();
});

it("still settles a sent turn when the service is lost", async () => {
  const fm = await import("../src/rebuild/firstmate.ts");
  const turn = fm.askFirstmate("Hello again");
  await tick();
  const sent = fake.sent.at(-1)!;
  expect(sent.command).toMatch(/^conversation/);
  fake.event({ kind: "service-lost" });
  await expect(turn).resolves.toMatchObject({ ok: false });
});

it("shows the saved model on the label without opening the conversation", async () => {
  const fm = await import("../src/rebuild/firstmate.ts");
  fake.event({ kind: "service-lost" });
  const seen: (string | null)[] = [];
  const listener = () => seen.push(fm.currentModel());
  const first = fake.sent.length;
  fm.subscribeModel(listener);
  fm.subscribeModel(listener);
  await tick();
  const read = fake.sent.slice(first);
  expect(read.map((c) => c.command)).toEqual(["default-model"]);
  reply(read[0]!.id, {
    kind: "message",
    text: JSON.stringify({
      model: "github-copilot/claude-sonnet-5.5",
      needsConversation: false,
    }),
  });
  await tick();
  expect(seen.at(-1)).toBe("github-copilot/claude-sonnet-5.5");
  // A context switch with nothing open only rereads the saved default.
  fake.product = "three";
  fake.update();
  await tick();
  expect(fake.sent.slice(first).map((c) => c.command)).toEqual([
    "default-model",
    "default-model",
  ]);
  // Sending a message is what opens the conversation.
  const send = fm.askFirstmate("Hello");
  await tick();
  expect(fake.sent.at(-1)!.command).toBe("conversation");
  reply(fake.sent.at(-1)!.id, conversation(two, "github-copilot/chosen"));
  await tick();
  expect(fm.currentModel()).toBe("github-copilot/chosen");
  void send;
});

it("opens the conversation for the label only when the saved files cannot say", async () => {
  const fm = await import("../src/rebuild/firstmate.ts");
  fake.event({ kind: "service-lost" });
  const before = fake.sent.length;
  fm.subscribeModel(() => {});
  await tick();
  const read = fake.sent.at(before)!;
  expect(read.command).toBe("default-model");
  reply(read.id, {
    kind: "message",
    text: JSON.stringify({ model: null, needsConversation: true }),
  });
  await tick();
  expect(fake.sent.slice(before).map((c) => c.command)).toEqual([
    "default-model",
    "conversation",
  ]);
});
