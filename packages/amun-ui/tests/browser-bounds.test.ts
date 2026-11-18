import { expect, test } from "vitest";
import { browserBounds } from "../src/rebuild/browser-bounds.ts";

const window = { x: 0, y: 0, width: 1000, height: 612 };
const scroller = { x: 180, y: 0, width: 780, height: 520 };

test("a panel that runs past the bottom of the window is cut to what shows", () => {
  // The Council's room is 496 tall and starts at 260 in a 612-tall window.
  // Sending the whole panel was refused by the app, which then drew the room
  // across the full window, over the sidebar.
  const placed = browserBounds(
    { x: 216, y: 260, width: 708, height: 496 },
    [window, scroller],
    [],
  );
  expect(placed).toEqual({
    visible: true,
    bounds: { x: 216, y: 260, width: 708, height: 260 },
  });
  expect(placed.bounds.y + placed.bounds.height).toBeLessThanOrEqual(612);
});

test("the room hides while search or a menu lies over it", () => {
  const panel = { x: 216, y: 260, width: 708, height: 200 };
  const search = { x: 0, y: 0, width: 1000, height: 612 };
  expect(browserBounds(panel, [window], [search]).visible).toBe(false);
  // A drawer beside the panel does not touch it.
  const beside = { x: 930, y: 0, width: 70, height: 612 };
  expect(browserBounds(panel, [window], [beside]).visible).toBe(true);
});

test("a panel scrolled out of sight, or a sliver of one, is not shown", () => {
  const off = { x: 216, y: 700, width: 708, height: 496 };
  expect(browserBounds(off, [window, scroller], []).visible).toBe(false);
  const sliver = { x: 216, y: 510, width: 708, height: 496 };
  expect(browserBounds(sliver, [window, scroller], []).visible).toBe(false);
  expect(browserBounds(null, [window], []).visible).toBe(false);
});

test("bounds are whole pixels inside the panel", () => {
  const placed = browserBounds(
    { x: 216.4, y: 260.6, width: 707.3, height: 100.2 },
    [window],
    [],
  );
  expect(placed.bounds).toEqual({ x: 217, y: 261, width: 706, height: 99 });
});
