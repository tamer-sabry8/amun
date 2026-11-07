import { expect, it } from "vitest";
import { nativeConversationView } from "../src/native-pi-conversation.ts";
import { Redactor } from "../../security/src/redaction.ts";
const id = "11111111-1111-4111-8111-111111111111";
it("projects only redacted conversation text with explicit session identity", () => {
  const redactor = new Redactor();
  redactor.register("CANARY_SECRET");
  const view = nativeConversationView(
    id,
    "Selected session",
    [
      {
        type: "message",
        message: { role: "user", content: "Hello CANARY_SECRET" },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Reply" },
            { type: "thinking", thinking: "private" },
          ],
        },
      },
      {
        type: "message",
        message: { role: "toolResult", content: "raw tool output" },
      },
    ],
    redactor,
  );
  expect(view).toMatchObject({
    kind: "conversation",
    sessionId: id,
    title: "Selected session",
    omittedItems: 2,
  });
  expect(view.text).toContain("[REDACTED]");
  expect(view.text).not.toMatch(/CANARY_SECRET|private|raw tool/);
});
it("renders an empty session honestly and rejects invalid scope and oversized content", () => {
  expect(nativeConversationView(id, "Empty", [], new Redactor()).text).toBe("");
  expect(() =>
    nativeConversationView("../personal", "Bad", [], new Redactor()),
  ).toThrow();
  expect(() =>
    nativeConversationView(
      id,
      "Large",
      [
        {
          type: "message",
          message: { role: "user", content: "a".repeat(262145) },
        },
      ],
      new Redactor(),
    ),
  ).toThrow();
});
