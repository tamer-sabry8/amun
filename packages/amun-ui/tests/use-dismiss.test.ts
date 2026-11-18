import { expect, it, vi } from "vitest";
import { attachDismiss } from "../src/rebuild/use-dismiss.ts";

function fake() {
  const listeners = new Map<string, (event: never) => void>();
  return {
    listeners,
    addEventListener: (type: string, fn: (event: never) => void) =>
      listeners.set(type, fn),
    removeEventListener: (type: string, fn: (event: never) => void) => {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
    fire: (type: string, event: object) =>
      (listeners.get(type) as (event: object) => void)(event),
  };
}

const menu = {} as Node;
const elsewhere = {} as Node;

it("closes on Escape only", () => {
  const doc = fake();
  const close = vi.fn();
  attachDismiss(doc as never, (node) => node === menu, close);
  doc.fire("keydown", { key: "a" });
  expect(close).not.toHaveBeenCalled();
  doc.fire("keydown", { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
});

it("closes on a press outside, not inside", () => {
  const doc = fake();
  const close = vi.fn();
  attachDismiss(doc as never, (node) => node === menu, close);
  doc.fire("mousedown", { target: menu });
  expect(close).not.toHaveBeenCalled();
  doc.fire("mousedown", { target: elsewhere });
  expect(close).toHaveBeenCalledTimes(1);
});

it("removes its listeners when detached", () => {
  const doc = fake();
  attachDismiss(doc as never, () => false, vi.fn())();
  expect(doc.listeners.size).toBe(0);
});
