import { expect, it, vi } from "vitest";
import { nativeTurn } from "../src/native-pi-turn.ts";
const id = "11111111-1111-4111-8111-111111111111";
function setup(completion: "ok" | "error" | "ack" | "abort") {
  let listener: (x: unknown) => void = () => {};
  const remove = vi.fn();
  const session = {
    sessionId: id,
    model: { provider: "test", id: "m" },
    isStreaming: false,
    subscribe: (fn: (x: unknown) => void) => {
      listener = fn;
      return remove;
    },
    prompt: vi.fn(async () => {
      if (completion !== "ack")
        listener({
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: completion === "ok" ? "stop" : "error",
            content: [{ type: "text", text: "Reply" }],
          },
        });
      listener({ type: "agent_settled", aborted: completion === "abort" });
    }),
  };
  return { session, remove };
}
const request = { sessionId: id, model: "test/m", text: "Hello" };
it("accepts only a matching active session/model and a completed assistant turn", async () => {
  const { session, remove } = setup("ok");
  await expect(nativeTurn(session, request)).resolves.toBe("completed");
  expect(session.prompt).toHaveBeenCalledWith("Hello", {
    expandPromptTemplates: false,
  });
  expect(remove).toHaveBeenCalledOnce();
  for (const mode of ["error", "ack"] as const)
    await expect(nativeTurn(setup(mode).session, request)).rejects.toThrow();
  await expect(nativeTurn(setup("abort").session, request)).resolves.toBe(
    "aborted",
  );
});
it("rejects unknown slash or shell operations, malformed input, stale selection and overlap before inference", async () => {
  const { session } = setup("ok");
  for (const bad of [
    { text: " /unknown" },
    { text: "!! secret" },
    { text: "" },
    { text: "x".repeat(12001) },
    { text: "x\0y" },
    { sessionId: "other" },
    { model: "other/model" },
    { unexpected: "field" },
  ])
    await expect(nativeTurn(session, { ...request, ...bad })).rejects.toThrow();
  session.isStreaming = true;
  await expect(nativeTurn(session, request)).rejects.toThrow();
  expect(session.prompt).not.toHaveBeenCalled();
});

it("refuses image content before calling the provider when Pi blocks it or the model is text-only", async () => {
  const { session } = setup("ok");
  const data = {
    sessionId: id,
    model: "test/m",
    text: "Inspect",
    image:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  };
  for (const [blocked, input] of [
    [true, ["text", "image"]],
    [false, ["text"]],
  ] as const) {
    await expect(
      nativeTurn(
        {
          ...session,
          model: { ...session.model, input },
          settingsManager: { getBlockImages: () => blocked },
        },
        data,
      ),
    ).rejects.toThrow("Image unavailable");
  }
  expect(session.prompt).not.toHaveBeenCalled();
});
