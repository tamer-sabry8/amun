// @vitest-environment jsdom
import { OfflinePlanning } from "../src/rebuild/resume-planning.tsx";
import {
  scopedDraftKey,
  loadDraft,
  savedPlanningLinks,
} from "../src/rebuild/planning-draft.ts";
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
    .mockReturnValue({ ...state, status: "Connected" });
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
    const row = container.querySelector<HTMLDetailsElement>(
      'details[aria-label^="Backlog story "]',
    )!;
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
    connection.mockReturnValue({ ...state, status: "Reconnecting" });
    root = createRoot(container);
    await mount();
    await act(async () => button("Add 1 story to Sprint 4").click());
    expect(container.textContent).toContain("Waiting for Firstmate");
    expect(chat).not.toHaveBeenCalled();
    expect(button("Add 1 story to Sprint 4").disabled).toBe(true);
    connection.mockReturnValue({ ...state, status: "Connected" });
    await mount();
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
    expect(openChat).not.toHaveBeenCalled();
    const link = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.startsWith("View request"),
    );
    expect(link).toBeTruthy();
    await act(async () => link!.click());
    expect(openChat).toHaveBeenCalledExactlyOnceWith(
      "chat",
      expect.stringMatching(/^amun-r-/),
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("restores a four-change draft offline, undoes one locally, and keeps the original shortcut", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  const scope = {
    areaId: "area",
    productId: "p",
    sourceId: "azure",
    team: "team",
    backlog: "Stories",
    sprintId: "4",
    iteration: "Sprint 4",
  };
  const draft = loadDraft(localStorage, scope);
  draft.moves = [1, 2, 3, 4].map((id) => ({
    id,
    title: "Story " + id,
    rev: 1,
    from: "Backlog",
    to: scope.iteration,
  }));
  localStorage.setItem(scopedDraftKey(scope), JSON.stringify(draft));
  const link = savedPlanningLinks(localStorage, new Set(["area"]))[0]!;
  const send = vi.spyOn(bridge, "send");
  const command = vi.spyOn(commands, "workAsync");
  const element = document.createElement("div"),
    root = createRoot(element);
  try {
    await act(async () =>
      root.render(createElement(OfflinePlanning, { link })),
    );
    expect(element.querySelectorAll("button")).toHaveLength(4);
    await act(async () => element.querySelector("button")!.click());
    expect(savedPlanningLinks(localStorage, new Set(["area"]))).toEqual([
      { ...link, count: 3 },
    ]);
    expect(loadDraft(localStorage, scope).moves.map((m) => m.id)).toEqual([
      2, 3, 4,
    ]);
    expect(command).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("asks for goal advice explicitly, stages the reviewed story, and leaves the suggested owner optional", async () => {
  const { SprintGoal } = await import("../src/rebuild/sprint-goal.tsx");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const scope = {
    areaId: "gitex",
    productId: "p",
    sourceId: "azure",
    team: "T",
    backlog: "Stories",
    sprintId: "4",
    iteration: "Gitex/Sprint 4",
  };
  const listeners = new Set<(e: unknown) => void>();
  vi.spyOn(bridge, "onEvent").mockImplementation((callback) => {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  });
  const send = vi.spyOn(bridge, "send").mockImplementation((raw) => {
    const r = raw as { requestId: string; ref: string };
    for (const receive of listeners)
      receive({
        kind: "ado-operation-result",
        productId: "p",
        requestId: r.requestId,
        requestRef: r.ref,
        message: "Review suggestions",
        suggestions: [
          {
            id: 24,
            rev: 3,
            reason: "Covers badge recovery",
            ownerId: "sam",
            evidenceId: 31,
          },
        ],
      });
  });
  vi.spyOn(commands, "workAsync").mockResolvedValue({
    action: "new-chat",
    ok: true,
    message: "",
    ref: "chat",
    step: null,
  });
  const stage = vi.fn();
  const card = {
    id: 24,
    rev: 3,
    title: "Replacement",
    type: "Story",
    column: null,
    state: "Ready",
    iteration: "Gitex/Sprint 5",
    prerequisites: [31],
  };
  const el = document.createElement("div"),
    root = createRoot(el);
  try {
    await act(async () =>
      root.render(
        createElement(SprintGoal, {
          scope,
          name: "Sprint 4",
          tag: "",
          cards: [card],
          people: [{ id: "sam", name: "Sam", uniqueName: "sam@example.test" }],
          enabled: true,
          stage,
          unavailable: () => false,
        }),
      ),
    );
    const input = el.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, "Badge recovery");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(send).not.toHaveBeenCalled();
    await act(async () => el.querySelector("button")!.click());
    expect(send).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain("Gitex/Sprint 5");
    expect(el.textContent).toContain("Unestimated");
    expect(el.textContent).toContain("Covers badge recovery");
    expect(stage).not.toHaveBeenCalled();
    const stageButton = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Stage #24"),
    )!;
    await act(async () => stageButton.click());
    expect(stage).toHaveBeenLastCalledWith(card, undefined);
    await act(async () =>
      el.querySelector<HTMLInputElement>("input[type=checkbox]")!.click(),
    );
    await act(async () => stageButton.click());
    expect(stage).toHaveBeenLastCalledWith(card, {
      from: null,
      to: { id: "sam", name: "Sam", uniqueName: "sam@example.test" },
    });
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  }
});

it("opens a verified blocker source and sends edited wording once with the original project and story", async () => {
  const { SprintBlockers } = await import("../src/rebuild/sprint-blockers.tsx");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const el = document.createElement("div"),
    root = createRoot(el);
  const discuss = vi
    .fn<(text: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const url = "https://example.test/C/Gitex/_workitems/edit/24";
  try {
    await act(async () =>
      root.render(
        createElement(SprintBlockers, {
          areaId: "gitex",
          project: "Gitex",
          sprintId: "ado:4",
          name: "Sprint 4",
          sourceId: "azure",
          teamId: "T",
          now: Date.now(),
          discuss,
          stories: [{ id: "24", title: "Badge replacement", storyUrl: url }],
          blockers: [
            {
              id: "b",
              workAreaId: "gitex",
              title: "Badge scanner",
              owner: "Sam",
              raisedAt: new Date().toISOString(),
              resolvedAt: null,
              sprintLink: {
                sourceId: "azure",
                sprintId: "ado:4",
                storyId: "24",
                teamId: "T",
              },
              ownerReplies: [
                {
                  id: 1,
                  version: 1,
                  url: url + "?discussionId=1",
                  body: "Scan both passes",
                  proposal: "Both passes scan.",
                  state: "reviewed",
                },
              ],
            },
          ],
        }),
      ),
    );
    expect(el.querySelector("a")?.href).toBe(url);
    expect(el.querySelector<HTMLTextAreaElement>("textarea")?.value).toContain(
      "Badge replacement",
    );
    const select = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Edit proposed criterion"),
    )!;
    await act(async () => select.click());
    const input = el.querySelector("textarea")!;
    expect(input.value).toBe("Both passes scan.");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, "Verify the replacement pass.");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(discuss).toHaveBeenCalledTimes(1);
    expect(discuss.mock.calls[0]![0]).toContain("Verify the replacement pass.");
    expect(discuss.mock.calls[0]![0]).toContain('"storyId":"24"');
    expect(discuss.mock.calls[0]![0]).toContain('"areaId":"gitex"');
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
