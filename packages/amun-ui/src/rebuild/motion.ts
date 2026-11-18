// Small one-off motions that have no state of their own. Each plays once on
// the element it is given and leaves nothing behind. People who ask their Mac
// to reduce motion get none of them.
const still = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

const ease = "cubic-bezier(0.16, 1, 0.3, 1)";

/** The send arrow leaves through the top of its button and returns from below. */
export function takeOff(arrow: Element | null | undefined) {
  if (!arrow || still() || typeof arrow.animate !== "function") return;
  arrow.animate(
    [
      { transform: "translateY(0)", opacity: 1 },
      { transform: "translateY(-20px)", opacity: 0, offset: 0.45 },
      { transform: "translateY(20px)", opacity: 0, offset: 0.46 },
      { transform: "translateY(0)", opacity: 1 },
    ],
    { duration: 500, easing: ease },
  );
}
