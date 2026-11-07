import { it, expect } from "vitest";
import {
  conversationSharePreview,
  registerCredentialSecrets,
} from "../src/conversation-share.ts";
import { Redactor } from "../src/redaction.ts";
it("projects only readable conversation text and redacts secrets before returning a review digest", () => {
  const redactor = new Redactor();
  redactor.register("CANARY_PRIVATE");
  const preview = conversationSharePreview(
    "Session",
    [
      {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Hello CANARY_PRIVATE" }],
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "PRIVATE_REASONING" },
            { type: "text", text: "Reply" },
          ],
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          content: [{ type: "text", text: "PRIVATE_TOOL" }],
        },
      },
    ],
    redactor,
  );
  expect(preview.text).toContain("[REDACTED]");
  expect(preview.text).not.toContain("CANARY_PRIVATE");
  expect(preview.text).not.toContain("PRIVATE_REASONING");
  expect(preview.text).not.toContain("PRIVATE_TOOL");
  expect(preview.contentHash).toMatch(/^[a-f0-9]{64}$/);
  expect(preview.omittedItems).toBe(2);
  expect(
    conversationSharePreview(
      "Other",
      [{ type: "message", message: { role: "user", content: "Hello" } }],
      redactor,
    ).contentHash,
  ).not.toBe(preview.contentHash);
});
it("refuses empty or excessive conversations instead of silently truncating", () => {
  const r = new Redactor();
  expect(() => conversationSharePreview("Empty", [], r)).toThrow();
  expect(() =>
    conversationSharePreview("Big", Array(1001).fill({}), r),
  ).toThrow();
  expect(() =>
    conversationSharePreview(
      "Big",
      [
        {
          type: "message",
          message: { role: "user", content: "x".repeat(262145) },
        },
      ],
      r,
    ),
  ).toThrow();
});

it("registers private credential values without serializing them and never invokes accessors", () => {
  const redactor = new Redactor();
  registerCredentialSecrets(redactor, {
    type: "oauth",
    access: "CANARY_ACCESS",
    refresh: "CANARY_REFRESH",
  });
  expect(redactor.text("CANARY_ACCESS CANARY_REFRESH")).toBe(
    "[REDACTED] [REDACTED]",
  );
  let calls = 0;
  const entry = Object.defineProperty({ type: "message" }, "message", {
    get() {
      calls++;
      return { role: "user", content: "private" };
    },
  });
  expect(() => conversationSharePreview("test", [entry], redactor)).toThrow();
  expect(calls).toBe(0);
  expect(() => registerCredentialSecrets(redactor, entry)).toThrow();
  expect(calls).toBe(0);
});
