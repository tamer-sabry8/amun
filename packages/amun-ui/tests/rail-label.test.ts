import { it, expect } from "vitest";
import { railLabel } from "../src/rail-label.ts";
it("keeps the plain drawer name while nothing is counted", () => {
  expect(railLabel("Activity")).toBe("Activity drawer");
  expect(railLabel("Activity", 0)).toBe("Activity drawer");
  expect(railLabel("Activity", -2)).toBe("Activity drawer");
  expect(railLabel("Activity", Number.NaN)).toBe("Activity drawer");
});
it("includes the visible count as its own word in the accessible name", () => {
  expect(railLabel("Activity", 1)).toBe("Activity drawer, 1 active");
  expect(railLabel("Activity", 12).split(/[^a-z0-9]+/i)).toContain("12");
});
