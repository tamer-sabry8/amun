import { expect, test, vi } from "vitest";
import { azurePulls } from "../src/azure-pulls.ts";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../../packages/connectors-ado/src/transport.ts", () => ({
  azureTransport: () => request,
}));
test("reads policy evaluations with the Azure Server preview contract", async () => {
  request.mockImplementation(async (_method: string, url: string) => {
    const u = new URL(url);
    let data: unknown = { value: [] };
    if (u.pathname.endsWith("/pullrequests/1"))
      data = {
        repository: { project: { id: "project" } },
        sourceRefName: "refs/heads/test/source",
        targetRefName: "refs/heads/test/base",
        lastMergeSourceCommit: { commitId: "a".repeat(40) },
        reviewers: [],
      };
    if (
      u.pathname.endsWith("/policy/evaluations") &&
      u.searchParams.get("api-version") !== "7.0-preview.1"
    )
      return { status: 400, data: null };
    return { status: 200, data };
  });
  expect(
    (
      await azurePulls(
        "https://example.test/collection/",
        "project",
        "repo",
        "test",
      ).details(1)
    ).checks,
  ).toEqual([]);
});
