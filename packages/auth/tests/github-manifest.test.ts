import { expect, it } from "vitest";
import { verifyAmunManifest } from "../src/github-manifest.ts";
const resource = {
  type: "resource",
  resource: {
    uri: "repo://tamer-sabry8/amun/refs/heads/main/contents/package.json",
    text: JSON.stringify({ name: "amun", packageManager: "pnpm@11.25.0" }),
  },
};
it("requires parsed manifest content from the requested repository", () => {
  expect(verifyAmunManifest({ content: [resource] })).toBe(true);
  for (const result of [
    { isError: true, content: [resource] },
    { content: [{ type: "text", text: "downloaded" }] },
    {
      content: [
        { ...resource, resource: { ...resource.resource, text: "{}" } },
      ],
    },
    {
      content: [
        {
          ...resource,
          resource: {
            ...resource.resource,
            uri: "repo://elsewhere/repo/contents/package.json",
          },
        },
      ],
    },
  ])
    expect(verifyAmunManifest(result)).toBe(false);
});
