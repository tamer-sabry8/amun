import { it, expect, vi } from "vitest";
import { resolveNotionTarget } from "../src/target.ts";
const id = "11111111-1111-4111-8111-111111111111",
  source = "22222222-2222-4222-8222-222222222222";
it("resolves a database URL to its actual data source and title property", async () => {
  const get = vi.fn(async (path: string) => ({
    status: 200,
    data: path.includes("/databases/")
      ? {
          object: "database",
          id,
          data_sources: [{ id: source, name: "Document Hub" }],
        }
      : {
          object: "data_source",
          id: source,
          parent: { type: "database_id", database_id: id },
          properties: {
            "Doc name": { id: "title", type: "title" },
            Category: { type: "multi_select" },
          },
        },
  }));
  expect(
    await resolveNotionTarget(
      "https://app.notion.com/p/" +
        id.replaceAll("-", "") +
        "?v=" +
        source.replaceAll("-", ""),
      get,
    ),
  ).toEqual({
    parentType: "data_source_id",
    parentId: source,
    titleProperty: "Doc name",
    label: "Document Hub",
  });
  expect(get.mock.calls.map((x) => x[0])).toEqual([
    "/v1/databases/" + id,
    "/v1/data_sources/" + source,
  ]);
});
it("resolves a page only after a database 404 and rejects unrelated hosts before API access", async () => {
  const get = vi.fn(async (path: string) =>
    path.includes("/databases/")
      ? { status: 404, data: null }
      : {
          status: 200,
          data: {
            object: "page",
            id,
            properties: {
              title: { type: "title", title: [{ plain_text: "Parent" }] },
            },
          },
        },
  );
  expect(
    await resolveNotionTarget(
      "https://notion.so/" + id.replaceAll("-", ""),
      get,
    ),
  ).toEqual({
    parentType: "page_id",
    parentId: id,
    titleProperty: "title",
    label: "Parent",
  });
  get.mockClear();
  for (const url of [
    "https://evil.test/" + id,
    "http://notion.so/" + id,
    "https://u:p@notion.so/" + id,
    "https://notion.so.evil.test/" + id,
  ])
    await expect(resolveNotionTarget(url, get)).rejects.toThrow();
  expect(get).not.toHaveBeenCalled();
});
it("refuses inaccessible, ambiguous or mismatched data sources rather than guessing", async () => {
  for (const data of [
    { object: "database", id, data_sources: [] },
    { object: "database", id, data_sources: [{ id: source }, { id }] },
    { object: "database", id: source, data_sources: [{ id: source }] },
  ])
    await expect(
      resolveNotionTarget("https://notion.so/" + id, async () => ({
        status: 200,
        data,
      })),
    ).rejects.toThrow();
  const get = vi.fn(async () => ({ status: 403, data: null }));
  await expect(
    resolveNotionTarget("https://notion.so/" + id, get),
  ).rejects.toThrow();
  expect(get).toHaveBeenCalledTimes(1);
});
