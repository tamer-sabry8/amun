import { expect, it } from "vitest";
import { latestTurnStart, scrollTarget } from "../src/rebuild/scroll-target.ts";

const you = { role: "you" };
const fm = { role: "firstmate" };
const card = { role: "card" };

it("shows a new Firstmate reply from its start", () => {
  expect(scrollTarget(1, [you, fm], false)).toBe("latest-reply");
  expect(scrollTarget(1, [you, card, fm], true)).toBe("latest-reply");
});

it("keeps the owner message and working indicator in view", () => {
  expect(scrollTarget(1, [fm, you], true)).toBe("end");
  expect(scrollTarget(2, [fm, you], true)).toBe("end");
  expect(scrollTarget(2, [fm, you, card], false)).toBe("end");
});

it("does not move when nothing new arrived", () => {
  expect(scrollTarget(2, [you, fm], false)).toBe("none");
});

it("opens at the bottom unless the newest message is a reply", () => {
  expect(scrollTarget(null, [fm, you], false)).toBe("end");
  expect(scrollTarget(null, [you, fm], false)).toBe("latest-reply");
  expect(scrollTarget(null, [], false)).toBe("end");
});

it("starts the latest turn at its first message, text before card", () => {
  expect(latestTurnStart([you, fm, fm, card])).toBe(1);
  expect(latestTurnStart([fm, you, fm, card])).toBe(2);
});

it("starts the latest turn at a lone card", () => {
  expect(latestTurnStart([you, card])).toBe(1);
  expect(latestTurnStart([fm, card, you, card])).toBe(3);
});

it("has no latest turn when the owner spoke last", () => {
  expect(latestTurnStart([fm, you])).toBe(-1);
  expect(latestTurnStart([])).toBe(-1);
});

it("without an owner message uses the trailing run of replies", () => {
  expect(latestTurnStart([fm, card])).toBe(0);
  expect(latestTurnStart([{ role: "system" }, fm, card])).toBe(1);
});
