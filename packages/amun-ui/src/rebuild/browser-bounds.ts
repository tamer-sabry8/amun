// Where the embedded browser view may be drawn. The view is a native layer
// above the whole interface, so it has to be told to stay inside the part of
// its panel that is actually on screen, and to step aside for anything Amun
// draws over that panel (search, a menu, the downloads note).
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlap = (a: Box, b: Box): Box | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : null;
};

/** Too little of the panel on screen to be worth showing a page in. */
const least = 24;

/**
 * The view's place for a panel at `panel`, kept inside every box in `within`
 * (the window, the scrolling area) and hidden when something in `covers`
 * lies over it. Bounds are whole pixels that never leave the window.
 */
export function browserBounds(
  panel: Box | null,
  within: Box[],
  covers: Box[],
): { visible: boolean; bounds: Box } {
  const none = { visible: false, bounds: { x: 0, y: 0, width: 1, height: 1 } };
  let box = panel;
  for (const limit of within) box = box && overlap(box, limit);
  if (!box) return none;
  const x = Math.ceil(box.x);
  const y = Math.ceil(box.y);
  const bounds = {
    x,
    y,
    width: Math.floor(box.x + box.width) - x,
    height: Math.floor(box.y + box.height) - y,
  };
  if (bounds.width < least || bounds.height < least) return none;
  return {
    visible: !covers.some((cover) => overlap(cover, bounds)),
    bounds,
  };
}

/** Things Amun draws above its screens. */
export const coverSelector =
  '.rb-palette, .rb-drawer, .rb-menu, .rb-island.floating, [role="dialog"]';
