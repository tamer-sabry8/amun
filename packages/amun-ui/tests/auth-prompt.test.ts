import { it, expect } from "vitest";
import { canSubmitAuthPrompt } from "../src/auth-prompt.ts";
it("lets Pi validate empty text defaults while requiring secrets and valid selections", () => {
  expect(canSubmitAuthPrompt({ method: "text", options: [] }, "")).toBe(true);
  expect(canSubmitAuthPrompt({ method: "secret", options: [] }, "")).toBe(
    false,
  );
  expect(canSubmitAuthPrompt({ method: "manual_code", options: [] }, "")).toBe(
    false,
  );
  expect(canSubmitAuthPrompt({ method: "secret", options: [] }, "key")).toBe(
    true,
  );
  expect(
    canSubmitAuthPrompt(
      { method: "select", options: [{ id: "a", label: "A" }] },
      "other",
    ),
  ).toBe(false);
  expect(
    canSubmitAuthPrompt(
      { method: "select", options: [{ id: "a", label: "A" }] },
      "a",
    ),
  ).toBe(true);
});
