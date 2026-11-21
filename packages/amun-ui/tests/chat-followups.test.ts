// @vitest-environment node
import { act, createElement } from "react";

import { expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (
    html: string,
    options: { url: string; pretendToBeVisual: boolean },
  ) => { window: Window & typeof globalThis };
};
import { openWorkStore } from "../../work-store/src/index.ts";
import { bridge } from "../src/bridge.ts";
import * as fm from "../src/rebuild/firstmate.ts";
import * as commands from "../src/rebuild/store.ts";

it("accepts two more prompts during a slow reply and drains them in order across a remount", async () => {
  const dom = new JSDOM("<html><body></body></html>", {
    url: "http://localhost",
    pretendToBeVisual: true,
  });
  for (const name of [
    "window",
    "document",
    "navigator",
    "localStorage",
    "HTMLElement",
    "HTMLTextAreaElement",
    "Element",
    "Node",
    "Event",
    "CustomEvent",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ] as const)
    vi.stubGlobal(name, dom.window[name]);
  const { createRoot } = await import("react-dom/client");
  const { WorkSession } = await import("../src/rebuild/work-session.tsx");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("CSS", { escape: (id: string) => id });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const opened = openWorkStore(":memory:");
  const run = (action: string, payload = {}) =>
    opened.store.handle({ version: 1, kind: "work", action, ...payload })[0]!;
  const created = run("create-area", {
    type: "project",
    groupId: null,
    name: "Pilot",
  });
  if (!("ref" in created) || !created.ref) throw Error("Area creation failed");
  const areaId = created.ref;
  const el = document.createElement("div");
  document.body.append(el);
  let root = createRoot(el);
  const noop = () => {};
  const render = () =>
    root.render(
      createElement(WorkSession, {
        snapshot: opened.store.snapshot(),
        areaId,
        chatId: null,
        now: Date.now(),
        workspace: null,
        model: "test",
        pane: null,
        ratio: 0.5,
        expanded: false,
        first: null,
        onChat: noop,
        onWork: noop,
        onPane: noop,
        onResize: noop,
        onExpand: noop,
        onGroupNeeded: noop,
        onSettings: noop,
      }),
    );
  const releases: (() => void)[] = [];
  const ask = vi.spyOn(fm, "askFirstmate").mockImplementation(
    () =>
      new Promise((resolve) => {
        releases.push(() =>
          resolve({
            ok: true,
            reply: "Received",
            model: "test",
            followups: [],
          }),
        );
      }),
  );
  vi.spyOn(commands, "workAsync").mockImplementation(
    async (action, payload) => run(action, payload) as never,
  );
  vi.spyOn(commands, "work").mockImplementation((action, payload) => {
    run(action, payload);
  });
  const listeners = new Set<(event: unknown) => void>();
  vi.spyOn(bridge, "onEvent").mockImplementation((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  });
  vi.spyOn(bridge, "send").mockImplementation((message) => {
    if (
      typeof message === "object" &&
      message &&
      "kind" in message &&
      message.kind === "tracker-types"
    )
      for (const listener of listeners)
        listener({
          version: 1,
          kind: "tracker-types-result",
          workAreaId: areaId,
          project: null,
          story: null,
          task: null,
          needs: [],
        });
  });
  async function send(text: string) {
    const input = el.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const button = el.querySelector<HTMLButtonElement>(
      'button[aria-label="Send"]',
    )!;
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
  }
  try {
    await act(async () => render());
    for (const text of ["First prompt", "Second prompt", "Third prompt"])
      await send(text);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(
      opened.store
        .snapshot()
        .messages.filter((m) => m.role === "you")
        .map((m) => m.text),
    ).toEqual(["First prompt", "Second prompt", "Third prompt"]);
    await act(async () => root.unmount());
    root = createRoot(el);
    await act(async () => render());
    expect(el.querySelectorAll(".rb-turn .tag.warn")).toHaveLength(2);
    for (let i = 0; i < 3; i++) await act(async () => releases[i]!());
    expect(
      ask.mock.calls.map(([prompt]) =>
        prompt.match(/(First|Second|Third) prompt/g)?.at(-1),
      ),
    ).toEqual(["First prompt", "Second prompt", "Third prompt"]);
    expect(fm.heldMessage(areaId)).toBeNull();
    const snapshot = opened.store.snapshot();
    const firstRequest = snapshot.requests.find(
      (req) =>
        req.messageId ===
        snapshot.messages.find((m) => m.text === "First prompt")?.id,
    )!;
    run("request-report", {
      ref: firstRequest.ref,
      status: "delivered",
      role: "Product Manager",
      detail: "Answered",
      parts: 0,
      fingerprint: "reply-test",
    });
    await act(async () => render());
    const link = [...el.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("View reply"),
    )!;
    await act(async () => link.click());
    const actual = el
      .querySelector(".rb-turn.firstmate.flash")
      ?.getAttribute("data-mid");
    expect(actual).toBe(
      snapshot.messages.find((m) => m.role === "firstmate")?.id,
    );
    expect(actual).toBeTruthy();
  } finally {
    await act(async () => root.unmount());
    el.remove();
    opened.close();
    vi.restoreAllMocks();
    dom.window.close();
    vi.unstubAllGlobals();
  }
});
