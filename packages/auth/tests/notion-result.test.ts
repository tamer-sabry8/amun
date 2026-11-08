import { expect, it } from "vitest";
import { notionIdentity, notionTargetReference } from "../src/notion-result.ts";
it("projects only bounded workspace/user identity, omitting email and raw records", () => {
  const result = notionIdentity({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          workspace: {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Workspace",
          },
          user: { type: "person", name: "User", email: "private@example.test" },
          access_token: "never-project",
        }),
      },
    ],
  });
  expect(result).toEqual({
    workspaceId: "11111111-1111-4111-8111-111111111111",
    workspaceName: "Workspace",
    userName: "User",
    userType: "person",
  });
  expect(() => notionIdentity({ isError: true, content: [] })).toThrow();
  expect(() =>
    notionIdentity({ content: [{ type: "text", text: "not json" }] }),
  ).toThrow();
});
it("accepts Notion page links and rejects foreign destinations", () => {
  expect(
    notionTargetReference(
      "https://app.notion.com/p/11111111111141118111111111111111?v=ignored",
    ),
  ).toBe("11111111111141118111111111111111");
  expect(() =>
    notionTargetReference("https://evil.test/11111111111141118111111111111111"),
  ).toThrow();
  expect(() =>
    notionTargetReference(
      "https://user:secret@notion.so/11111111111141118111111111111111",
    ),
  ).toThrow();
});

it("binds database destinations to their fetched identity and explicit title schema", async () => {
  const { notionDestination } = await import("../src/notion-result.ts");
  const id = "11111111111141118111111111111111";
  const source = "22222222-2222-4222-8222-222222222222";
  const body = {
    metadata: { type: "database" },
    title: "Documents",
    url: "https://www.notion.so/" + id,
    text: `<database><data-source url="collection://${source}"><data-source-state>{"name":"Documents","schema":{"Doc name":{"name":"Doc name","type":"title"}}}</data-source-state></data-source></database>`,
  };
  const wrap = (value: unknown) => ({
    content: [{ type: "text", text: JSON.stringify(value) }],
  });
  expect(
    notionDestination(
      wrap({
        ...body,
        text: body.text.replace(
          `collection://${source}`,
          `{{collection://${source}}}`,
        ),
      }),
      id,
    ),
  ).toMatchObject({ parentId: source });
  expect(notionDestination(wrap(body), id)).toEqual({
    title: "Documents",
    parentId: source,
    parentType: "data_source_id",
    titleProperty: "Doc name",
  });
  expect(() =>
    notionDestination(
      wrap({ ...body, url: "https://www.notion.so/" + source }),
      id,
    ),
  ).toThrow();
  expect(() =>
    notionDestination(wrap({ ...body, text: body.text + body.text }), id),
  ).toThrow();
  expect(() =>
    notionDestination(
      wrap({
        ...body,
        text: body.text.replace('"type":"title"', '"type":"rich_text"'),
      }),
      id,
    ),
  ).toThrow();
});
it("allows a verified page destination but rejects errors and foreign or truncated fetches", async () => {
  const { notionDestination } = await import("../src/notion-result.ts");
  const id = "11111111111141118111111111111111";
  const body = {
    metadata: { type: "page" },
    title: "Section",
    url: "https://www.notion.so/" + id,
  };
  const wrap = (value: unknown) => ({
    content: [{ type: "text", text: JSON.stringify(value) }],
  });
  expect(notionDestination(wrap(body), id)).toMatchObject({
    parentType: "page_id",
    titleProperty: "title",
    title: "Section",
  });
  for (const invalid of [
    { ...body, truncated: true },
    { ...body, metadata: { type: "connector" } },
    { ...body, url: "https://evil.test/" + id },
  ])
    expect(() => notionDestination(wrap(invalid), id)).toThrow();
  expect(() => notionDestination({ isError: true, content: [] }, id)).toThrow();
});
