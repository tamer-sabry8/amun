import { expect, it } from "vitest";
import { scrollTarget } from "../src/rebuild/scroll-target.ts";

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
