// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  matchesProjectTag,
  ProjectFilter,
  useProjectFilter,
} from "../src/rebuild/project-backlog-filter.tsx";

it("retains an explicit tag per project, shows a valid empty result and reveals the team without altering the saved tag", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const host = document.createElement("div"),
    root = createRoot(host);
  function Screen({ productId }: { productId: string }) {
    const filter = useProjectFilter({
      productId,
      sourceId: "Azure",
      team: "Alpha",
      backlog: "requirements",
    });
    return createElement(ProjectFilter, {
      filter,
      labels: ["Gitex"],
      matching: 0,
      total: 12,
      noun: "sprint",
    });
  }
  try {
    await act(() => root.render(createElement(Screen, { productId: "first" })));
    host.querySelector("select")!.value = "Gitex";
    await act(() => host.querySelector("form")!.requestSubmit());
    expect(host.textContent).toContain("0 of 12 team stories");
    await act(() => host.querySelector("button")!.click());
    expect(host.textContent).toContain("12 of 12 team stories");
    await act(() => root.render(createElement(Screen, { productId: "other" })));
    expect(host.querySelector("select")!.value).toBe("");
    expect(matchesProjectTag(["GITEX"], "Gitex")).toBe(true);
    expect(matchesProjectTag(["Gitex 2025"], "Gitex")).toBe(false);
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
