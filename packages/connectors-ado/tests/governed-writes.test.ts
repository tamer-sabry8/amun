import { it, expect } from "vitest";
import { AdoTypeMissing, AdoWriteClient } from "../src/governed-writes.ts";
const base = "https://example.test/C/";
it("creates at the root with the approved marker and parent, verifies the receipt, then commits separately using the reviewed revision", async () => {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fields: Record<string, unknown> = {
    "System.Title": "Test Task",
    "System.WorkItemType": "Task",
    "System.AreaPath": "Library",
    "System.IterationPath": "Library",
    "System.Tags": "Test-abc",
  };
  const client = new AdoWriteClient(
    base,
    "Library",
    async (method, url, body) => {
      calls.push({ method, url, body });
      if (method === "PATCH")
        fields["System.IterationPath"] = "Library\\Sprint";
      return {
        status: 200,
        data: {
          id: 2,
          rev: method === "POST" ? 1 : 2,
          fields,
          relations: [
            {
              rel: "System.LinkTypes.Hierarchy-Reverse",
              url: base + "_apis/wit/workItems/1",
            },
          ],
        },
      };
    },
  );
  const step = {
    itemId: "local",
    type: "Task",
    parentId: "parent",
    fields: {
      "System.Title": "Test Task",
      "System.AreaPath": "Library",
      "System.IterationPath": "Library",
    },
    marker: "Test-abc",
    revision: 0,
    remoteId: null,
  };
  await client.write(step, 1);
  expect(calls[0]?.body).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "/fields/System.Tags",
        value: "Test-abc",
      }),
      expect.objectContaining({ path: "/relations/-" }),
    ]),
  );
  expect(calls[0]?.body).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "/fields/System.AssignedTo" }),
    ]),
  );
  await client.write(
    {
      ...step,
      parentId: null,
      revision: 1,
      remoteId: 2,
      fields: { "System.IterationPath": "Library\\Sprint" },
    },
    null,
  );
  expect(
    (calls.find((x) => x.method === "PATCH")?.body as unknown[])[0],
  ).toEqual({ op: "test", path: "/rev", value: 1 });
  expect(calls.at(-1)?.method).toBe("GET");
});
it("uses the board's mapping and tested revision; rejects unmapped types and stale edits", async () => {
  const { editBoardCard } = await import("../src/card-edit.ts");
  const columns = [
    { id: "review", name: "Review", stateMappings: { Task: "Active" } },
  ];
  let patch: unknown;
  const args = {
    id: 7,
    rev: 4,
    title: "Updated",
    type: "Task",
    column: "Review",
    columnField: "WEF.column",
    columns,
  };
  const client = {
    write: async (step: unknown) => {
      patch = step;
      throw Error("revision_conflict");
    },
  };
  await expect(editBoardCard(args, client)).rejects.toThrow(
    "revision_conflict",
  );
  expect(patch).toMatchObject({
    revision: 4,
    remoteId: 7,
    fields: {
      "System.State": "Active",
      "System.Title": "Updated",
      "WEF.column": "Review",
    },
  });
  await expect(
    editBoardCard({ ...args, type: "Epic" }, client),
  ).rejects.toThrow("mapping");
});

it("accepts Azure rich-text block-end spacing but rejects changed text", async () => {
  const fields = {
    "System.WorkItemType": "Task",
    "System.Tags": "Test-marker",
    "System.Description": "<ul><li>The result is visible. </li> </ul>",
  };
  const client = new AdoWriteClient(base, "Library", async () => ({
    status: 200,
    data: { id: 2, rev: 1, fields },
  }));
  const step = {
    itemId: "local",
    type: "Task",
    parentId: null,
    revision: 0,
    remoteId: null,
    marker: "Test-marker",
    fields: {
      "System.Description": "<ul><li>The result is visible.</li></ul>",
    },
  };
  await expect(client.verify(2, step, null)).resolves.toEqual({
    id: 2,
    rev: 1,
  });
  fields["System.Description"] = "<ul><li>The result was visible. </li> </ul>";
  await expect(client.verify(2, step, null)).rejects.toThrow("verification");
});
it("marks only Azure's missing-type rejection of a create", async () => {
  const step = {
    itemId: "i",
    type: "User Story",
    parentId: null,
    fields: { "System.Title": "T" },
    marker: "Amun-1",
    revision: 0,
    remoteId: null,
  };
  const reply = (status: number, data: unknown) =>
    new AdoWriteClient(base, "POCs", async () => ({ status, data }));
  await expect(
    reply(404, { typeKey: "WorkItemTypeDoesNotExistException" }).write(
      step,
      null,
    ),
  ).rejects.toBeInstanceOf(AdoTypeMissing);
  await expect(
    reply(400, {
      message: "TF26199: The work item type User Story does not exist.",
    }).write(step, null),
  ).rejects.toBeInstanceOf(AdoTypeMissing);
  const other = await reply(400, { message: "Field is required" })
    .write(step, null)
    .catch((error: Error) => error);
  expect(other).not.toBeInstanceOf(AdoTypeMissing);
  expect((other as Error).message).toBe("request_rejected_400");
});
const found = (project: string, id = 5) => ({
  id,
  rev: 1,
  fields: {
    "System.TeamProject": project,
    "System.Title": "T",
    "System.Tags": "Amun-x",
  },
  relations: [],
});
it("accepts a project name that differs only by case or encoding", async () => {
  const client = new AdoWriteClient(base, "My POCs", async () => ({
    status: 200,
    data: found("my%20pocs"),
  }));
  await expect(client.item(5)).resolves.toMatchObject({ id: 5 });
});
it("still refuses an item from another project", async () => {
  const client = new AdoWriteClient(base, "POCs", async () => ({
    status: 200,
    data: found("Other"),
  }));
  await expect(client.item(5)).rejects.toThrow("identity mismatch");
});
it("asks each type alone when the server rejects an unknown type in the search", async () => {
  const queries: string[] = [];
  const client = new AdoWriteClient(base, "POCs", async (method, url, body) => {
    if (url.includes("wiql")) {
      const query = (body as { query: string }).query;
      queries.push(query);
      if (query.includes(",")) return { status: 400, data: {} };
      if (query.includes("'Nope'")) return { status: 400, data: {} };
      return { status: 200, data: { workItems: [{ id: 5 }] } };
    }
    return { status: 200, data: found("POCs") };
  });
  await expect(
    client.existing("T", ["Product Backlog Item", "Nope"]),
  ).resolves.toEqual({ id: 5 });
  expect(queries).toHaveLength(3);
});
it("still fails a search a single type cannot answer", async () => {
  const client = new AdoWriteClient(base, "POCs", async () => ({
    status: 400,
    data: {},
  }));
  await expect(client.existing("T", "Task", 1)).rejects.toThrow(
    "request_rejected_400",
  );
});
