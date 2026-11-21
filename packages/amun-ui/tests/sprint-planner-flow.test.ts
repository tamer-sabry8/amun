// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { SprintPlanner } from "../src/rebuild/sprint-planner.tsx";
import { bridge } from "../src/bridge.ts";
import * as commands from "../src/rebuild/store.ts";
it("stages locally across a remount, holds an offline apply and sends a connected double click once", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const handlers = new Set<(e: unknown) => void>();
  const scope = {
    areaId: "gitex",
    productId: "p",
    sourceId: "source",
    team: "T",
    backlog: "Stories",
    sprintId: "4",
    iteration: "Gitex/Sprint 4",
  };
  vi.spyOn(bridge, "onEvent").mockImplementation((fn) => {
    handlers.add(fn);
    return () => {
      handlers.delete(fn);
    };
  });
  const send = vi.spyOn(bridge, "send").mockImplementation((raw) => {
    const m = raw as { action: string; requestId: string };
    if (m.action === "cards")
      for (const h of handlers)
        h({
          kind: "backlog-result",
          view: "cards",
          requestId: m.requestId,
          productId: "p",
          columns: [],
          canEditBoard: false,
          cards: [
            {
              id: 24,
              rev: 3,
              title: "Badge printing",
              type: "Story",
              state: "Ready for rehearsal",
              assignee: "Sam",
              estimates: [{ name: "Effort", value: 3 }],
              criteria: "Print the confirmed badge",
              labels: ["Launch"],
              blocked: "Yes",
              column: null,
              iteration: "Gitex",
            },
          ],
        });
  });
  const state = bridge.getSnapshot();
  const connection = vi
    .spyOn(bridge, "getSnapshot")
    .mockReturnValue({ ...state, status: "Reconnecting" });
  const chat = vi.spyOn(commands, "workAsync").mockResolvedValue({
    action: "new-chat",
    ok: true,
    message: "",
    step: null,
    ref: "chat",
  });
  const container = document.createElement("div");
  document.body.append(container);
  let root = createRoot(container);
  const openChat = vi.fn();
  const mount = () =>
    act(async () =>
      root.render(
        createElement(SprintPlanner, {
          scope,
          name: "Sprint 4",
          members: [],
          openChat,
        }),
      ),
    );
  const button = (text: string) =>
    Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === text,
    )!;
  try {
    await mount();
    const row = container.querySelector("details")!;
    expect(row.querySelector("summary")?.textContent).toContain(
      "Ready for rehearsal · Effort 3 · Gitex · Blocked: Yes",
    );
    await act(async () => row.querySelector("summary")!.click());
    expect(row.open).toBe(true);
    expect(row.textContent).toContain("Print the confirmed badge");
    expect(row.textContent).toContain("Launch");
    expect(chat).not.toHaveBeenCalled();
    await act(async () => button("+ Sprint").click());
    expect(button("Add 1 story to Sprint 4")).toBeTruthy();
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    await act(async () => button("Add 1 story to Sprint 4").click());
    expect(container.textContent).toContain("Waiting for Firstmate");
    expect(chat).not.toHaveBeenCalled();
    connection.mockReturnValue({ ...state, status: "Connected" });
    await act(async () => {
      button("Add 1 story to Sprint 4").click();
      button("Add 1 story to Sprint 4").click();
    });
    const applies = send.mock.calls
      .map(([m]) => m as { action: string })
      .filter((m) => m.action === "apply-sprint-moves");
    expect(applies).toHaveLength(1);
    expect(applies[0]).toMatchObject({
      chatId: "chat",
      moves: [{ id: 24, rev: 3, from: "Gitex", to: "Gitex/Sprint 4" }],
    });
    expect(openChat).toHaveBeenCalledExactlyOnceWith("chat");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
