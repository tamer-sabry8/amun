import { expect, it } from "vitest";
import { riceScore } from "../src/rice.ts";
it("scores people per quarter × impact × confidence percentage / person-months", () => {
  const base = { reach: 120, impact: 2, confidence: 75, effort: 3 };
  expect(riceScore(base)).toBe(60);
  for (const field of ["reach", "impact", "confidence", "effort"])
    expect(riceScore({ ...base, [field]: null })).toBeNull();
  expect(riceScore({ ...base, reach: 0 })).toBe(0);
  expect(riceScore({ ...base, confidence: 0 })).toBe(0);
  for (const patch of [
    { reach: -1 },
    { reach: 0.5 },
    { impact: -1 },
    { impact: 9 },
    { confidence: 101 },
    { confidence: -2 },
    { effort: 0 },
    { effort: -1 },
    { effort: NaN },
    { reach: Infinity },
    { effort: Number.MIN_VALUE },
  ])
    expect(() => riceScore({ ...base, ...patch })).toThrow();
});
