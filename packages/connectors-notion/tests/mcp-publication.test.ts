import { it, expect, vi } from "vitest";
import { NotionMcpPublisher } from "../src/mcp-publication.ts";
const id = "11111111-1111-4111-8111-111111111111";
const pageId = "22222222-2222-4222-8222-222222222222";
const draft = {
  parentId: id,
  title: "Reviewed conversation",
  text: "Exact reviewed Markdown",
};
const result = {
  content: [
    {
      type: "text",
      text: JSON.stringify({
        pages: [{ id: pageId, properties: { title: draft.title } }],
      }),
    },
  ],
};
it("creates exactly one page through MCP with the reviewed destination and content", async () => {
  const call = vi.fn(async () => result);
  expect(await new NotionMcpPublisher(call).create(draft)).toEqual({
    state: "created",
    pageId,
  });
  expect(call).toHaveBeenCalledExactlyOnceWith({
    name: "notion-create-pages",
    arguments: {
      parent: { page_id: id },
      pages: [{ properties: { title: draft.title }, content: draft.text }],
      allow_async: false,
    },
  });
});
it("uses the explicitly reviewed data source and title property without altering its schema", async () => {
  const call = vi.fn(async (_request: unknown) => {
    void _request;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            pages: [{ id: pageId, properties: { "Doc name": draft.title } }],
          }),
        },
      ],
    };
  });
  expect(
    await new NotionMcpPublisher(call).create({
      ...draft,
      parentType: "data_source_id",
      titleProperty: "Doc name",
    }),
  ).toEqual({ state: "created", pageId });
  expect(call.mock.calls[0]![0]).toMatchObject({
    arguments: {
      parent: { data_source_id: id },
      pages: [{ properties: { "Doc name": draft.title } }],
    },
  });
});
it("never retries errors, malformed replies, async results or changed publication warnings", async () => {
  for (const response of [
    null,
    { isError: true },
    { content: [] },
    { content: [{ type: "text", text: "not json" }] },
    {
      content: [
        { type: "text", text: JSON.stringify({ async_task: { id: "task" } }) },
      ],
    },
    {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            pages: [{ id: pageId, properties: { title: draft.title } }],
            warnings: [{ code: "changed" }],
          }),
        },
      ],
    },
    {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            pages: [{ id: pageId, properties: { title: "Changed" } }],
          }),
        },
      ],
    },
  ]) {
    const call = vi.fn(async () => response);
    expect(await new NotionMcpPublisher(call).create(draft)).toEqual({
      state: "unknown",
    });
    expect(call).toHaveBeenCalledTimes(1);
  }
  const call = vi.fn(async () => {
    throw Error("lost acknowledgement");
  });
  expect(await new NotionMcpPublisher(call).create(draft)).toEqual({
    state: "unknown",
  });
  expect(call).toHaveBeenCalledTimes(1);
});
it("rejects invalid or oversized reviewed input before any network call", async () => {
  const call = vi.fn();
  for (const invalid of [
    { ...draft, parentId: "bad" },
    { ...draft, title: "" },
    { ...draft, text: "" },
    { ...draft, text: "a".repeat(262145) },
    { ...draft, titleProperty: "__proto__" },
    { ...draft, titleProperty: "bad\nname" },
  ])
    await expect(
      new NotionMcpPublisher(call).create(invalid),
    ).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});
