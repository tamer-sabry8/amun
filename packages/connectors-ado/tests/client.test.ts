import { it, expect, vi } from "vitest";
import { AdoProofClient } from "../src/client.ts";
const base = "https://devops.example.test/Collection/";
it("pins API 7.0 on reads and encodes project identifiers", async () => {
  const transport = vi
    .fn()
    .mockResolvedValue({ status: 200, data: { value: [] } });
  const client = new AdoProofClient(base, "Test Project", transport);
  await client.read("types");
  expect(transport).toHaveBeenCalledWith(
    "GET",
    base + "Test%20Project/_apis/wit/workitemtypes?api-version=7.0",
    undefined,
  );
});
it("allows only scoped proof writes and binds updates to revisions", async () => {
  const transport = vi
    .fn()
    .mockResolvedValue({ status: 200, data: { id: 12, rev: 2 } });
  const client = new AdoProofClient(base, "ICV", transport);
  await client.create("Task", "Test Task", 11);
  expect(transport.mock.calls[0]?.[0]).toBe("POST");
  expect(transport.mock.calls[0]?.[2]).toEqual([
    { op: "add", path: "/fields/System.Title", value: "Test Task" },
    {
      op: "add",
      path: "/fields/Microsoft.VSTS.Common.Activity",
      value: "Testing",
    },
    {
      op: "add",
      path: "/fields/Microsoft.VSTS.Scheduling.OriginalEstimate",
      value: 0,
    },
    {
      op: "add",
      path: "/fields/Microsoft.VSTS.Scheduling.RemainingWork",
      value: 0,
    },
    {
      op: "add",
      path: "/relations/-",
      value: {
        rel: "System.LinkTypes.Hierarchy-Reverse",
        url: base + "_apis/wit/workItems/11",
      },
    },
  ]);
  await client.update(12, 2);
  expect(transport.mock.calls[1]?.[2]).toEqual([
    { op: "test", path: "/rev", value: 2 },
    {
      op: "add",
      path: "/fields/System.Description",
      value: "Test revision precondition verified.",
    },
  ]);
});
it("rejects unsafe endpoints, titles and revisions before transport", async () => {
  const transport = vi.fn();
  for (const url of [
    "http://example.test/",
    "https://user:secret@example.test/",
    "https://example.test/?token=x",
  ])
    expect(() => new AdoProofClient(url, "ICV", transport)).toThrow();
  const client = new AdoProofClient(base, "ICV", transport);
  await expect(client.read("https://evil.test/")).rejects.toThrow();
  await expect(client.create("Task", "Amun test")).rejects.toThrow();
  await expect(client.create("Bug", "Test Task")).rejects.toThrow();
  await expect(client.update(12, 0)).rejects.toThrow();
  await expect(client.update(-1, 2)).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});
it.each([409, 412])(
  "reports a revision conflict (%s) without retry",
  async (status) => {
    const transport = vi
      .fn()
      .mockResolvedValue({ status, data: { message: "secret-canary" } });
    await expect(
      new AdoProofClient(base, "ICV", transport).update(12, 1),
    ).rejects.toThrow("revision_conflict");
    expect(transport).toHaveBeenCalledTimes(1);
  },
);
it("keeps a lost write acknowledgement unknown and never exposes error bodies", async () => {
  const transport = vi.fn().mockRejectedValue(new Error("secret-canary"));
  await expect(
    new AdoProofClient(base, "ICV", transport).create("Task", "Test Task"),
  ).rejects.toThrow("write_outcome_unknown");
  expect(transport).toHaveBeenCalledTimes(1);
});
it("rejects malformed successful work-item responses", async () => {
  const transport = vi
    .fn()
    .mockResolvedValue({ status: 200, data: { id: 12 } });
  await expect(
    new AdoProofClient(base, "ICV", transport).create("Task", "Test Task"),
  ).rejects.toThrow("write_outcome_unknown");
});

it("does not treat object prototype names as endpoints", async () => {
  const transport = vi.fn();
  await expect(
    new AdoProofClient(base, "ICV", transport).read("toString"),
  ).rejects.toThrow("Unsupported proof endpoint");
  expect(transport).not.toHaveBeenCalled();
});
