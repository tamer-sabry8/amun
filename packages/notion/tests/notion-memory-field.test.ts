import { expect, it } from "vitest";
import { readNotionField } from "../src/notion-memory-field.ts";
const page = "11111111-1111-4111-8111-111111111111";
it("maps one hosted Markdown line without absorbing its neighboring publication footer", () => {
  const reply = {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          url: "https://www.notion.so/" + page,
          metadata: { type: "page" },
          text: "<page>\n<content>\nSync status: Draft<br />Amun publication ID: fixture\n</content>\n</page>\n<parent-data-source-schema />",
        }),
      },
    ],
  };
  expect(readNotionField(reply, page, "Sync status")).toEqual({
    kind: "value",
    value: "Draft",
    boundary: "<br />Amun publication ID: fixture",
  });
});
