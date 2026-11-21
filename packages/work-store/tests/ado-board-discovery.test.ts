import { expect, it, vi } from "vitest";
import { BoardDiscovery } from "../src/ado-board-discovery.ts";

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
it("reads dated, completed and undated team iterations", async () => {
  const get = vi.fn(async (method: string, url: string) => {
    expect(method).toBe("GET");
    expect(new URL(url).pathname).toBe(
      "/Collection/Library/West%20Team/_apis/work/teamsettings/iterations",
    );
    const item = (n: number, timeFrame: string, startDate?: string) => ({
      id: "i" + n,
      name: "Sprint " + n,
      path: "Library\\Sprint " + n,
      attributes: { timeFrame, startDate, finishDate: startDate },
    });
    return {
      status: 200,
      data: {
        value: [
          item(3, "future", "2026-12-01T00:00:00Z"),
          item(1, "past", "2026-10-01T00:00:00Z"),
          item(2, "current", "2026-11-10T00:00:00Z"),
          item(4, "future"),
        ],
      },
    };
  });
  const d = new BoardDiscovery(base, "Library", get);
  expect((await d.sprints("West Team")).map((s) => s.name)).toEqual([
    "Sprint 4",
    "Sprint 1",
    "Sprint 2",
    "Sprint 3",
  ]);
  expect(await d.sprints("West Team", 1)).toHaveLength(1);
});
it("reads the story and task types from the default team's backlog configuration once", async () => {
  const get = vi.fn(async (_method: string, url: string) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/_apis/projects/POCs"))
      return { status: 200, data: { defaultTeam: { name: "POCs Team" } } };
    expect(path).toBe(
      "/Collection/POCs/POCs%20Team/_apis/work/backlogconfiguration",
    );
    return {
      status: 200,
      data: {
        requirementBacklog: {
          defaultWorkItemType: { name: "Product Backlog Item" },
          workItemTypes: [{ name: "Product Backlog Item" }, { name: "Bug" }],
        },
        taskBacklog: { workItemTypes: [{ name: "Task" }] },
      },
    };
  });
  const d = new BoardDiscovery(base, "POCs", get);
  expect(await d.backlogTypes()).toEqual({
    story: "Product Backlog Item",
    task: "Task",
  });
  await d.backlogTypes();
  expect(get).toHaveBeenCalledTimes(2);
});

it("reads a sprint's work items with title, type, state and assignee", async () => {
  const get = vi.fn(async (_method: string, url: string) => {
    const u = new URL(url);
    return u.pathname.endsWith("/workitems") &&
      u.pathname.includes("teamsettings")
      ? {
          status: 200,
          data: {
            workItemRelations: [{ target: { id: 2 } }, { target: { id: 1 } }],
          },
        }
      : {
          status: 200,
          data: {
            value: [
              {
                id: 1,
                fields: {
                  "System.Title": "Login",
                  "System.State": "Active",
                  "System.WorkItemType": "User Story",
                  "System.AssignedTo": { displayName: "Sam" },
                },
              },
              {
                id: 2,
                fields: {
                  "System.Title": "Logout",
                  "System.State": "New",
                  "System.WorkItemType": "Bug",
                },
              },
            ],
          },
        };
  });
  const result = await new BoardDiscovery(base, "Library", get).iterationItems(
    "West",
    "guid-1",
  );
  expect(result.more).toBe(false);
  expect(result.items).toEqual([
    { id: 2, title: "Logout", type: "Bug", state: "New", assignee: null },
    {
      id: 1,
      title: "Login",
      type: "User Story",
      state: "Active",
      assignee: "Sam",
    },
  ]);
  expect(get.mock.calls.every(([method]) => method === "GET")).toBe(true);
});

it("reads every sprint member in batches and rejects a missing item", async () => {
  const ids = Array.from({ length: 203 }, (_, i) => i + 1);
  let omitLast = false;
  const get = vi.fn(async (_method: string, raw: string) => {
    const query = new URL(raw).searchParams.get("ids");
    if (query === null)
      return {
        status: 200,
        data: { workItemRelations: ids.map((id) => ({ target: { id } })) },
      };
    const batch = query.split(",").map(Number);
    expect(batch.length).toBeLessThanOrEqual(200);
    return {
      status: 200,
      data: {
        value: batch
          .filter((id) => !omitLast || id !== 203)
          .map((id) => ({
            id,
            fields: {
              "System.Title": String(id),
              "System.State": "Active",
              "System.WorkItemType": "Story",
            },
          })),
      },
    };
  });
  const reader = new BoardDiscovery(base, "Library", get);
  const result = await reader.iterationItems("West", "iteration");
  expect(result.items.map((item) => item.id)).toEqual(ids);
  expect(result.more).toBe(false);
  omitLast = true;
  await expect(reader.iterationItems("West", "iteration")).rejects.toThrow(
    "Incomplete Azure sprint",
  );
});
