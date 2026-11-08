import { expect, it } from "vitest";
import { Redactor } from "../../security/src/redaction.ts";
import { stowConversation } from "../src/stow-conversation.ts";
it("includes visible evidence with roles, excludes tools, private thinking and hidden operations", () => {
  const msg = (role: string, content: unknown) => ({
    type: "message",
    message: { role, content },
  });
  const r = new Redactor();
  r.register("disposable-canary");
  expect(
    stowConversation(
      [
        msg("user", "I prefer weekly reports."),
        msg("assistant", [
          { type: "thinking", thinking: "hidden" },
          { type: "text", text: "Smoke tests use disposable-canary." },
        ]),
        msg("toolResult", "private"),
        msg("user", "\u2063FIRSTMATE_OP: hidden"),
      ],
      r,
    ),
  ).toEqual([
    { role: "user", text: "I prefer weekly reports." },
    { role: "assistant", text: "Smoke tests use [REDACTED]." },
  ]);
});

it("keeps product conversation text out of the shared crew memory input", () => {
  const entries = [
    {
      type: "message",
      message: { role: "user", content: "Keep Atlas pricing fixed." },
    },
  ];
  expect(stowConversation(entries, new Redactor(), "atlas")).toEqual([]);
});

it("accepts an explicitly crew-wide working note from a product without capturing the product discussion", () => {
  const r = new Redactor();
  r.register("test-private");
  expect(
    stowConversation(
      [
        {
          type: "message",
          message: { role: "user", content: "Atlas launch date is Friday." },
        },
      ],
      r,
      "atlas",
      "I prefer short summaries. token=test-private",
    ),
  ).toEqual([
    { role: "user", text: "I prefer short summaries. token=[REDACTED]" },
  ]);
});
