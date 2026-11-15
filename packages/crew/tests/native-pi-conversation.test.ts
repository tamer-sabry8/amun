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
it("ignores executable accessors on recorded tool output", () => {
  const part = {
    type: "text",
    get text() {
      throw Error("accessor invoked");
    },
  };
  const entries = [
    { type: "message", message: { role: "toolResult", content: [part] } },
  ];
  expect(
    nativeConversationView(id, "Tools", entries, new Redactor()),
  ).not.toHaveProperty("toolOutput");
});
const msg = (role: string, text: string) => ({
  type: "message",
  message: { role, content: [{ type: "text", text }] },
});
it("bounds cumulative history, keeping the newest assistant action whole", () => {
  const doc = "D".repeat(53000);
  const action = '```amun-actions\n{"type":"story"}\n```' + "x".repeat(150000);
  const entries = [
    ...Array.from({ length: 1100 }, (_, i) => msg("user", "old" + i)),
    msg("user", doc),
    msg("assistant", "a"),
    msg("user", doc),
    msg("assistant", "b"),
    msg("user", doc),
    msg("user", "L".repeat(200000)),
    msg("assistant", action),
  ];
  const view = nativeConversationView(id, "Big", entries, new Redactor());
  expect(view.text.length).toBeLessThanOrEqual(240000);
  expect(view.text).toContain(action);
  expect(view.omittedItems).toBeGreaterThan(100);
  const kept = view.text.split("## ").length - 1;
  expect(view.omittedItems).toBe(entries.length - kept);
});
it("handles a maximum-size user turn plus a large assistant reply", () => {
  const entries = [
    msg("user", "u".repeat(200000)),
    msg("assistant", "r".repeat(230000)),
  ];
  const view = nativeConversationView(id, "Max", entries, new Redactor());
  expect(view.text.length).toBeLessThanOrEqual(240000);
  expect(view.text).toContain("r".repeat(230000));
  expect(view.omittedItems).toBe(1);
});
it("says when the newest assistant reply is cut and drops an unfinished action", () => {
  const reply = 'Plan.\n```amun\n{"do":"convert","note":"' + "y".repeat(250000);
  const view = nativeConversationView(
    id,
    "Big",
    [msg("assistant", reply)],
    new Redactor(),
  );
  expect(view.text.length).toBeLessThanOrEqual(240000);
  expect(view.text).toContain("[Partial:");
  expect(view.text).toContain("Plan.");
  expect(view.text).not.toContain("```amun");
});
it("returns only the newest reply when the bounded transcript skips messages", () => {
  const act = (n: string) => '```amun\n{"do":"plan","n":"' + n + '"}\n```';
  const first = act("one") + "x".repeat(50000);
  const second = act("two") + "y".repeat(50000);
  const turn1 = [msg("user", "u".repeat(150000)), msg("assistant", first)];
  const v1 = nativeConversationView(id, "T", turn1, new Redactor());
  const turn2 = [
    ...turn1,
    msg("user", "q".repeat(200000)),
    msg("assistant", second),
  ];
  const v2 = nativeConversationView(id, "T", turn2, new Redactor());
  expect(v1.replyCount).toBe(1);
  expect(v1.latestReply).toBe(first);
  expect(v2.replyCount).toBe(2);
  expect(v2.latestReply).toBe(second);
  expect(v2.latestReply).not.toContain("one");
  // The count keeps rising when older entries fall outside the window.
  const many = Array.from({ length: 1100 }, () => msg("assistant", "a"));
  expect(nativeConversationView(id, "T", many, new Redactor()).replyCount).toBe(
    1100,
  );
  // A newest reply that is too large to read is never replaced by an older one.
  const huge = nativeConversationView(
    id,
    "T",
    [...turn1, msg("assistant", "z".repeat(300000))],
    new Redactor(),
  );
  expect(huge.latestReply).toBeUndefined();
});
