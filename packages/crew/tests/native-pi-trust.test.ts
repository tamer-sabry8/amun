import { it, expect, vi } from "vitest";
import { NativePiTrust } from "../src/native-pi-trust.ts";
it("persists only an explicit decision for the owned workspace and verifies it", () => {
  let value: boolean | null = null;
  const store = {
    get: vi.fn(() => value),
    set: vi.fn((_path: string, next: boolean | null) => {
      value = next;
    }),
  };
  const trust = new NativePiTrust(store, "/owned/workspace");
  expect(trust.run("").kind).toBe("choices");
  expect(trust.run("trust")).toEqual({
    kind: "message",
    text: "Trust decision saved for this Amun workspace. Loaded resources are unchanged until reload.",
  });
  expect(store.set).toHaveBeenCalledWith("/owned/workspace", true);
  trust.run("deny");
  expect(value).toBe(false);
  trust.run("ask");
  expect(value).toBe(null);
  for (const input of ["/personal", "trust parent", "true"])
    expect(() => trust.run(input)).toThrow();
});
it("does not report success when the store fails to persist the decision", () => {
  const trust = new NativePiTrust(
    { get: () => null, set: () => {} },
    "/owned/workspace",
  );
  expect(() => trust.run("trust")).toThrow();
});
