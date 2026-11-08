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
