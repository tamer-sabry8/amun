import { expect, it, vi } from "vitest";
import { NotionPublisher, type NotionSend } from "../src/client.ts";
const parentId = "11111111-1111-4111-8111-111111111111";
const pageId = "22222222-2222-4222-8222-222222222222";
it("creates exactly one page under the chosen parent with literal reviewed text", async () => {
  const send = vi.fn<NotionSend>(async () => ({
    status: 200,
    data: {
      object: "page",
      id: pageId,
      parent: { type: "page_id", page_id: parentId },
    },
  }));
  const client = new NotionPublisher(send);
  expect(
    await client.create({
      parentId,
      title: "Review",
      text: "![external](https://example.test/private)\nHello",
    }),
  ).toEqual({ state: "created", pageId });
  expect(send).toHaveBeenCalledTimes(1);
  const body = send.mock.calls[0]![0] as {
    children: { paragraph: { rich_text: { text: { content: string } }[] } }[];
  };
  expect(body.children[0]!.paragraph.rich_text[0]!.text.content).toBe(
    "![external](https://example.test/private)\nHello",
  );
});
it("does not retry uncertain responses or expose provider error bodies", async () => {
  for (const response of [
    { status: 503, data: { message: "SECRET" } },
    { status: 200, data: {} },
    { status: 302, data: {} },
  ]) {
    const send = vi.fn(async () => response);
    expect(
      await new NotionPublisher(send).create({
        parentId,
        title: "Review",
        text: "Hello",
      }),
    ).toEqual({ state: "unknown" });
    expect(send).toHaveBeenCalledTimes(1);
  }
  const send = vi.fn(async () => {
    throw Error("SECRET");
  });
  expect(
    await new NotionPublisher(send).create({
      parentId,
      title: "Review",
      text: "Hello",
    }),
  ).toEqual({ state: "unknown" });
  expect(send).toHaveBeenCalledTimes(1);
});
it("rejects invalid destinations or excessive content before calling the API", async () => {
  const send = vi.fn();
  for (const input of [
    { parentId: "https://notion.so", title: "x", text: "y" },
    { parentId, title: "", text: "y" },
    { parentId, title: "x", text: "x".repeat(196001) },
  ])
    await expect(new NotionPublisher(send).create(input)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});
it("refuses success for a mismatched returned parent and bounds text chunks", async () => {
  const send = vi.fn<NotionSend>(async () => ({
    status: 200,
    data: {
      object: "page",
      id: pageId,
      parent: { type: "page_id", page_id: pageId },
    },
  }));
  expect(
    await new NotionPublisher(send).create({
      parentId,
      title: "x",
      text: "😀".repeat(2000),
    }),
  ).toEqual({ state: "unknown" });
  const json = JSON.stringify(send.mock.calls[0]![0]);
  expect(json).not.toMatch(/\\ud[89ab][0-9a-f]{2}/i);
});
it("refuses a serialized payload above the API request budget before sending", async () => {
  const send = vi.fn<NotionSend>();
  await expect(
    new NotionPublisher(send).create({
      parentId,
      title: "x",
      text: "漢".repeat(180000),
    }),
  ).rejects.toThrow("Notion publication exceeds request limits");
  expect(send).not.toHaveBeenCalled();
});
it("creates database entries under the data source using its selected title property", async () => {
  const send = vi.fn<NotionSend>(async () => ({
    status: 200,
    data: {
      object: "page",
      id: pageId,
      parent: { type: "data_source_id", data_source_id: parentId },
    },
  }));
  const result = await new NotionPublisher(send).create({
    parentId,
    parentType: "data_source_id",
    titleProperty: "Doc name",
    title: "Reviewed conversation",
    text: "Safe text",
  });
  expect(result).toEqual({ state: "created", pageId });
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      parent: { type: "data_source_id", data_source_id: parentId },
      properties: {
        "Doc name": {
          type: "title",
          title: [{ type: "text", text: { content: "Reviewed conversation" } }],
        },
      },
    }),
  );
});
