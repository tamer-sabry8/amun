import { expect, it, vi } from "vitest";
import { BoardDiscovery } from "../src/board-discovery.ts";

const base = "https://example.test/Collection/";
it("discovers paged team boards, caches a complete result and refreshes on demand", async () => {
  const get = vi.fn(async (method: string, url: string) => {
    expect(method).toBe("GET");
    const u = new URL(url);
    expect(u.pathname).toBe(
      "/Collection/Library/West%20Team/_apis/work/boards",
    );
    expect(u.searchParams.get("api-version")).toBe("7.0");
    return u.searchParams.has("continuationToken")
      ? { status: 200, data: { value: [{ id: "b", name: "Tasks" }] } }
      : {
          status: 200,
          data: { value: [{ id: "a", name: "Stories" }] },
          continuationToken: "next & final",
        };
  });
  const discovery = new BoardDiscovery(base, "Library", get);
  const boards = await discovery.boards("West Team");
  expect(boards.map((b) => b.name)).toEqual(["Stories", "Tasks"]);
  expect(await discovery.boards("West Team")).toEqual(boards);
  expect(get).toHaveBeenCalledTimes(2);
  await discovery.boards("West Team", true);
  expect(get).toHaveBeenCalledTimes(4);
});
it("does not cache failed or partial discoveries; distinguishes access denial", async () => {
  const get = vi
    .fn()
    .mockResolvedValueOnce({
      status: 200,
      data: { value: [] },
      continuationToken: "x",
    })
    .mockResolvedValueOnce({ status: 403, data: null })
    .mockResolvedValueOnce({ status: 200, data: { value: [] } });
  const d = new BoardDiscovery(base, "Library", get);
  await expect(d.boards("West")).rejects.toThrow("request_rejected_403");
  expect(await d.boards("West")).toEqual([]);
});
it("rejects a repeated continuation token and invalid path segments", async () => {
  const get = vi.fn().mockResolvedValue({
    status: 200,
    data: { value: [] },
    continuationToken: "repeat",
  });
  const d = new BoardDiscovery(base, "Library", get);
  await expect(d.boards("West")).rejects.toThrow("Invalid Azure pagination");
  await expect(d.boards("..")).rejects.toThrow();
  expect(get).toHaveBeenCalledTimes(2);
});
it("reads states by work-item type and preserves split-column mapping for the selected board", async () => {
  const get = vi.fn().mockResolvedValue({
    status: 200,
    data: {
      value: [
        {
          id: "col-1",
          name: "Working",
          isSplit: true,
          stateMappings: { Bug: "Active", Task: "Doing" },
        },
      ],
    },
  });
  const d = new BoardDiscovery(base, "Library", get);
  const columns = await d.columns("West Team", "Sprint Board");
  expect(columns).toEqual([
    {
      id: "col-1",
      name: "Working",
      isSplit: true,
      stateMappings: { Bug: "Active", Task: "Doing" },
    },
  ]);
  expect(new URL(get.mock.calls[0]![1]).pathname).toBe(
    "/Collection/Library/West%20Team/_apis/work/boards/Sprint%20Board/columns",
  );
});
it("loads cards from the selected team backlog in server order, in bounded requests, retaining revision and actual board column", async () => {
  const ids = Array.from({ length: 201 }, (_, i) => i + 1);
  const get = vi.fn(async (_method: string, raw: string) => {
    const u = new URL(raw);
    if (u.pathname.endsWith("/workItems") && u.pathname.includes("/backlogs/"))
      return {
        status: 200,
        data: { workItems: ids.map((id) => ({ target: { id } })) },
      };
    const batch = u.searchParams.get("ids")!.split(",").map(Number);
    expect(batch.length).toBeLessThanOrEqual(200);
    return {
      status: 200,
      data: {
        value: batch.reverse().map((id) => ({
          id,
          rev: 7,
          fields: {
            "System.Title": "Example " + id,
            "System.WorkItemType": "Issue",
            "System.State": "Active",
            "WEF_Test.Kanban.Column": "Review",
          },
        })),
      },
    };
  });
  const d = new BoardDiscovery(base, "Library", get);
  const cards = await d.cards(
    "West",
    "Example.RequirementCategory",
    "WEF_Test.Kanban.Column",
  );
  expect(cards.map((card) => card.id)).toEqual(ids);
  expect(cards[0]).toMatchObject({
    rev: 7,
    column: "Review",
    state: "Active",
    title: "Example 1",
    type: "Issue",
  });
  expect(get).toHaveBeenCalledTimes(3);
});
it("discovers project process, nested paths, work item states and required fields without inventing defaults", async () => {
  const responses: Record<string, unknown> = {
    "/Collection/_apis/projects/Library": {
      name: "Library",
      capabilities: { processTemplate: { templateName: "Scrum" } },
    },
    "/Collection/Library/_apis/wit/workitemtypes": {
      value: [{ name: "Task" }],
    },
    "/Collection/Library/_apis/wit/workitemtypes/Task/fields": {
      value: [
        {
          name: "Activity",
          referenceName: "Example.Activity",
          alwaysRequired: true,
          allowedValues: ["Testing"],
        },
      ],
    },
    "/Collection/Library/_apis/wit/workitemtypes/Task/states": {
      value: [{ name: "New" }],
    },
    "/Collection/Library/_apis/wit/classificationnodes/areas": {
      name: "Library",
      children: [{ name: "East" }],
    },
    "/Collection/Library/_apis/wit/classificationnodes/iterations": {
      name: "Library",
      children: [{ name: "Sprint 1" }],
    },
  };
  const get = vi.fn(async (_method: string, url: string) => ({
    status: 200,
    data: responses[new URL(url).pathname],
  }));
  const d = new BoardDiscovery(base, "Library", get);
  const schema = await d.processSchema();
  expect(schema).toMatchObject({
    process: "Scrum",
    areas: ["Library", "Library\\East"],
    iterations: ["Library", "Library\\Sprint 1"],
    types: [
      {
        name: "Task",
        states: ["New"],
        fields: [
          {
            referenceName: "Example.Activity",
            required: true,
            allowedValues: ["Testing"],
          },
        ],
      },
    ],
  });
  await d.processSchema();
  expect(get).toHaveBeenCalledTimes(6);
});
it("pages the project team directory with Azure's top/skip API", async () => {
  const get = vi.fn(async (_method: string, raw: string) => {
    const u = new URL(raw);
    expect(u.searchParams.get("$top")).toBe("100");
    const offset = Number(u.searchParams.get("$skip"));
    return {
      status: 200,
      data: {
        value: Array.from({ length: offset ? 1 : 100 }, (_, i) => ({
          id: String(offset + i),
          name: "Team " + (offset + i),
        })),
      },
    };
  });
  const d = new BoardDiscovery(base, "Library", get);
  expect((await d.teams()).at(-1)).toEqual({ id: "100", name: "Team 100" });
  expect(get).toHaveBeenCalledTimes(2);
});
