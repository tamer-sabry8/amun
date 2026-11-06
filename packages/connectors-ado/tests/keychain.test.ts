import { it, expect } from "vitest";
import { validatePat } from "../src/keychain.ts";
it("accepts PAT-shaped secrets and rejects malformed input without echoing it", () => {
  expect(validatePat("a".repeat(52))).toBe("a".repeat(52));
  for (const value of [
    "",
    "secret-canary",
    "a".repeat(513),
    "a".repeat(30) + "\n",
    "a".repeat(30) + " ",
  ]) {
    expect(() => validatePat(value)).toThrow("Invalid PAT format");
  }
});
