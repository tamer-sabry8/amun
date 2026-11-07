import { expect, it, vi } from "vitest";
import { findNotionPublication } from "../src/notion-recovery.ts";
const marker = "12345678-1234-4123-8123-123456789abc";
const page = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  parent = "33333333-3333-4333-8333-333333333333";
const intent = {
  marker,
  parentId: parent,
  parentType: "data_source_id" as const,
};
const result = (v: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(v) }],
});
function fetched(id: string, body: string, parentId = parent) {
  return result({
    id,
    url: "https://www.notion.so/" + id,
    title: "Repeated title",
    metadata: { type: "page" },
    text:
      '<page url="https://www.notion.so/' +
      id +
      '">\n<ancestor-path>\n<parent-data-source url="collection://' +
      parentId +
      '" name="Hub"/>\n</ancestor-path>\n<content>\n' +
      body +
      "\n</content>\n</page>",
  });
}
const footer = "Amun publication ID: " + marker;
it("recovers the exact page after a lost reply, ignoring duplicate titles", async () => {
  const call = vi.fn(async (name: string, args: Record<string, unknown>) =>
    name === "notion-search"
      ? result({ results: [{ id: other }, { id: page }] })
      : fetched(String(args.id), args.id === page ? footer : "Something else"),
  );
  expect(await findNotionPublication(intent, call)).toBe(page);
  expect(call.mock.calls[0]?.[1].query).toBe(marker);
});
it("leaves edited, deleted, copied, or wrong-parent footers unresolved", async () => {
  for (const body of [footer + " changed", "removed", footer + "\n" + footer]) {
    expect(
      await findNotionPublication(
        intent,
        async () => fetched(page, body),
        "https://www.notion.so/" + page,
      ),
    ).toBeUndefined();
  }
  expect(
    await findNotionPublication(
      intent,
      async () => fetched(page, footer, other),
      "https://www.notion.so/" + page,
    ),
  ).toBeUndefined();
  expect(
    await findNotionPublication(intent, async (name, args) =>
      name === "notion-search"
        ? result({ results: [{ id: page }, { id: other }] })
        : fetched(String(args.id), footer),
    ),
  ).toBeUndefined();
});
it("ignores property-like markup inside a conversation", async () => {
  const fake =
    "<properties>\n" +
    JSON.stringify({ "Amun publication ID": marker }) +
    "\n</properties>";
  expect(
    await findNotionPublication(
      { ...intent, property: true },
      async () => fetched(page, fake),
      "https://www.notion.so/" + page,
    ),
  ).toBeUndefined();
});
