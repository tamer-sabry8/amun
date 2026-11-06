import { it, expect } from "vitest";
import { previewDecision, HandoffSlot } from "../src/preview-navigation.ts";
it("blocks main/popup IdPs and silently blocks IdP subframes", () => {
  for (const host of [
    "accounts.google.com",
    "ACCOUNTS.GOOGLE.COM.",
    "login.microsoftonline.com",
    "login.live.com",
    "appleid.apple.com",
  ]) {
    expect(previewDecision("https://" + host + "/", true)).toBe("handoff");
    expect(previewDecision("https://" + host + "/", false)).toBe("block");
  }
});
it("retains strict URL policy without suffix/query confusion", () => {
  for (const url of [
    "https://accounts.google.com.evil.test",
    "https://example.com/?next=https://accounts.google.com",
    "http://localhost:3000",
    "https://github.com/login",
  ])
    expect(previewDecision(url, true)).toBe("allow");
  for (const url of [
    "https://accounts.google.com@evil.test",
    "http://example.com",
    "file:///etc/passwd",
    "about:blank",
    "javascript:alert(1)",
    "not a url",
  ])
    expect(previewDecision(url, true)).toBe("block");
});
it("holds only a short-lived opaque user action, invalidates stale actions and throttles globally", () => {
  let now = 100;
  let sequence = 0;
  const slot = new HandoffSlot(
    () => now,
    () => String(++sequence),
  );
  const id = slot.offer("https://example.com/login");
  expect(slot.open("wrong")).toBeNull();
  expect(slot.open(id!)).toBe("https://example.com/login");
  expect(slot.open(id!)).toBeNull();
  const next = slot.offer("https://other.test/");
  expect(slot.open(next!)).toBeNull();
  now += 2001;
  expect(slot.open(next!)).toBe("https://other.test/");
  const expired = slot.offer("https://example.com");
  now += 60001;
  expect(slot.open(expired!)).toBeNull();
  const cleared = slot.offer("https://example.com");
  slot.clear();
  expect(slot.open(cleared!)).toBeNull();
  expect(slot.offer("file:///secret")).toBeNull();
});
