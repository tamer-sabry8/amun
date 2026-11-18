import { it, expect } from "vitest";
import { initialLayout, layoutReducer } from "../src/layout.ts";
it("Focus hides panels and restores the exact prior layout", () => {
  const before = {
    ...initialLayout,
    inspector: "issue" as const,
    drawer: "activity" as const,
    pinned: true,
    island: "expanded" as const,
    terminal: true,
  };
  const focused = layoutReducer(before, { type: "focus" });
  expect(focused.focus).toBe(true);
  expect(focused.drawer).toBeNull();
  expect(focused.inspector).toBeNull();
  expect(focused.island).toBe("rail");
  expect(layoutReducer(focused, { type: "focus" })).toEqual(before);
});
it("keeps one drawer, click pin toggles, hover cannot replace a pinned drawer, and background updates never open panels", () => {
  let state = layoutReducer(initialLayout, {
    type: "hover",
    drawer: "notifications",
  });
  expect(state.drawer).toBe("notifications");
  expect(state.pinned).toBe(false);
  state = layoutReducer(state, { type: "pin", drawer: "activity" });
  expect(state.drawer).toBe("activity");
  expect(state.pinned).toBe(true);
  expect(layoutReducer(state, { type: "hover", drawer: "skills" })).toEqual(
    state,
  );
  expect(layoutReducer(state, { type: "leave" })).toEqual(state);
  state = layoutReducer(state, { type: "pin", drawer: "activity" });
  expect(state.drawer).toBeNull();
  expect(layoutReducer(initialLayout, { type: "data" })).toEqual(initialLayout);
});
it("does not allow panels to open while Focus is active and toggles terminal only explicitly", () => {
  const focused = layoutReducer(initialLayout, { type: "focus" });
  expect(layoutReducer(focused, { type: "pin", drawer: "activity" })).toEqual(
    focused,
  );
  expect(layoutReducer(focused, { type: "inspect", tab: "web" })).toEqual(
    focused,
  );
  expect(layoutReducer(initialLayout, { type: "terminal" }).terminal).toBe(
    true,
  );
  expect(
    layoutReducer(initialLayout, { type: "inspect", tab: "web" }).inspector,
  ).toBe("web");
});
