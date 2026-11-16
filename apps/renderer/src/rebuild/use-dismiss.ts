// Closes an open menu on Escape or a press outside it. `root` must hold the
// menu and its trigger, so pressing the trigger is left to its own handler.
import { useEffect, type RefObject } from "react";

type Target = Pick<Document, "addEventListener" | "removeEventListener">;

export function attachDismiss(
  target: Target,
  inside: (node: Node | null) => boolean,
  onClose: (reason: "escape" | "outside") => void,
): () => void {
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape") onClose("escape");
  };
  const press = (event: MouseEvent) => {
    if (!inside(event.target as Node | null)) onClose("outside");
  };
  target.addEventListener("keydown", key);
  target.addEventListener("mousedown", press);
  return () => {
    target.removeEventListener("keydown", key);
    target.removeEventListener("mousedown", press);
  };
}

export function useDismiss(
  open: boolean,
  roots: RefObject<HTMLElement | null> | RefObject<HTMLElement | null>[],
  onClose: (reason: "escape" | "outside") => void,
) {
  useEffect(() => {
    if (!open) return;
    return attachDismiss(
      document,
      (node) =>
        !!node && [roots].flat().some((root) => root.current?.contains(node)),
      onClose,
    );
    // Callers pass state setters, which are stable, so onClose is not a dependency.
  }, [open, roots]);
}
