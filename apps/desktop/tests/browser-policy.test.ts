import { describe, it, expect } from "vitest";
import {
  browserURL,
  browserPartition,
  browserCommand,
} from "../src/browser-policy.ts";
describe("isolated browser policy", () => {
  it("accepts HTTPS and loopback HTTP prototypes", () => {
    expect(browserURL("https://example.com/login")).toBe(
      "https://example.com/login",
    );
    expect(browserURL("http://127.0.0.1:8080/")).toBe("http://127.0.0.1:8080/");
    expect(browserURL("http://[::1]:8080/")).toBe("http://[::1]:8080/");
  });
  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,hi",
    "http://example.com",
    "https://user:secret@example.com",
    "http://127.0.0.1.evil.test",
    "https://example.com/\\n",
    "x".repeat(8193),
    null,
    {},
  ])("refuses unsafe navigation %j", (value) => {
    expect(browserURL(value)).toBeNull();
  });
  it("separates validated product partitions", () => {
    expect(browserPartition("m0")).toBe("persist:amun-browser-m0");
    expect(browserPartition("other")).not.toBe(browserPartition("m0"));
    for (const value of ["../personal", "", "a/b", "A B"])
      expect(() => browserPartition(value)).toThrow();
  });
  it("accepts only narrow browser commands", () => {
    expect(
      browserCommand({ action: "navigate", url: "https://example.com" }),
    ).toEqual({ action: "navigate", url: "https://example.com/" });
    expect(browserCommand({ action: "close" })).toEqual({ action: "close" });
    for (const value of [
      { action: "exec", code: "x" },
      { action: "back", url: "x" },
      { action: "navigate", url: "file:///x" },
      null,
    ])
      expect(browserCommand(value)).toBeNull();
  });
});
