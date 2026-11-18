import { describe, expect, test } from "vitest";
import { isAmunOriginAllowed } from "./attach-amun.js";

describe("/amun origin check", () => {
  test("refuses pages from other websites, even though the browser is on loopback", () => {
    expect(isAmunOriginAllowed("https://evil.example")).toBe(false);
    expect(isAmunOriginAllowed("http://127.0.0.1.evil.example")).toBe(false);
    expect(isAmunOriginAllowed("null")).toBe(false);
  });

  test("allows Amun's own UI, the desktop app and non-browser clients", () => {
    expect(isAmunOriginAllowed(undefined)).toBe(true);
    expect(isAmunOriginAllowed("http://127.0.0.1:6768")).toBe(true);
    expect(isAmunOriginAllowed("http://localhost:5173")).toBe(true);
    expect(isAmunOriginAllowed("paseo://app", new Set(["paseo://app"]))).toBe(true);
    expect(isAmunOriginAllowed("paseo://app")).toBe(false);
  });
});
