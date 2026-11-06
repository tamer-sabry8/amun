import { it, expect } from "vitest";
import { clipboardRequest } from "../src/pi-clipboard-policy.ts";
it("accepts only a bounded explicit text-copy request", () => {
  expect(
    clipboardRequest({ action: "copy", id: "request-1", text: "reply" }),
  ).toEqual({ action: "copy", id: "request-1", text: "reply" });
  for (const value of [
    null,
    { action: "read", id: "x", text: "x" },
    { action: "copy", id: "x", text: "x", secret: "bad" },
    { action: "copy", id: "x", text: "x".repeat(262145) },
    { action: "copy", id: "x", text: "\0" },
  ])
    expect(clipboardRequest(value)).toBeNull();
});
