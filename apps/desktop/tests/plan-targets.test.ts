import { describe, expect, it } from "vitest";
import {
  adoPlanTarget,
  adoStep,
  notionPlanTarget,
} from "../src/plan-targets.ts";
import { PlanNotSent } from "../../../packages/data/src/plan-publication.ts";
import type { AzureProcessSchema } from "../../../packages/contracts/src/backlog.ts";

const field = (referenceName: string) => ({
  referenceName,
  name: referenceName,
  required: false,
  allowedValues: [],
});
const schema = {
  types: [
    { name: "Bug", fields: [field("System.Title")] },
    {
      name: "Product Backlog Item",
      fields: [
        field("System.Title"),
        field("System.Description"),
        field("Microsoft.VSTS.Common.AcceptanceCriteria"),
      ],
    },
  ],
  areas: ["POCs", "POCs\\Pilot"],
  iterations: ["POCs", "POCs\\Sprint 1"],
} as unknown as AzureProcessSchema;
const item = (fields: Record<string, string | number | null> = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  summary: "Invite <10> testers",
  fields,
  marker: "3b0f6a52-58a5-4c0e-9d3e-6f7a1f1f0c11",
  destination: "ado",
});

describe("Azure DevOps plan items", () => {
  it("becomes the project's story type with escaped rich text", () => {
    const step = adoStep(
      item({ description: "Dubai & Abu Dhabi", acceptance: "One\nTwo" }),
      schema,
      "POCs",
    );
    expect(step).toMatchObject({
      type: "Product Backlog Item",
      marker: "Amun-3b0f6a52-58a5-4c0e-9d3e-6f7a1f1f0c11",
      remoteId: null,
      revision: 0,
      fields: {
        "System.Title": "Invite <10> testers",
        "System.Description": "<p>Dubai &amp; Abu Dhabi</p>",
        "Microsoft.VSTS.Common.AcceptanceCriteria":
          "<ul><li>One</li><li>Two</li></ul>",
      },
    });
  });
  it("refuses a type, area or iteration the project does not have", () => {
    expect(() => adoStep(item({ type: "Epic" }), schema, "POCs")).toThrow(
      PlanNotSent,
    );
    expect(() => adoStep(item({ area: "Other" }), schema, "POCs")).toThrow(
      PlanNotSent,
    );
    expect(() =>
      adoStep(item({ iteration: "POCs\\Sprint 9" }), schema, "POCs"),
    ).toThrow(PlanNotSent);
    expect(
      adoStep(item({ iteration: "POCs\\Sprint 1" }), schema, "POCs").fields[
        "System.IterationPath"
      ],
    ).toBe("POCs\\Sprint 1");
  });
  it("returns the work item ID and a link to it", async () => {
    const target = adoPlanTarget(
      "https://devops.example/Collection/",
      "POCs",
      { processSchema: async () => schema },
      {
        write: async () => ({ id: 4711 }),
        find: async () => undefined,
      },
    );
    expect(await target.write(item())).toEqual({
      externalId: "4711",
      url: "https://devops.example/Collection/POCs/_workitems/edit/4711",
    });
    expect(await target.find(item())).toBeUndefined();
  });
  it("reports an unreadable project as unsent", async () => {
    const target = adoPlanTarget(
      "https://devops.example/Collection/",
      "POCs",
      {
        processSchema: async () => {
          throw Error("request_rejected_401");
        },
      },
      {
        write: async () => {
          throw Error("must not write");
        },
        find: async () => undefined,
      },
    );
    await expect(target.write(item())).rejects.toBeInstanceOf(PlanNotSent);
  });
});

describe("Notion plan items", () => {
  const page = "11111111-2222-4333-8444-555555555555";
  const destination = {
    title: "test for Amun to use",
    parentId: "41735810-e3a9-80ea-ae45-d78ca230f0a3",
    parentType: "page_id" as const,
    titleProperty: "title",
  };
  it("creates a child page carrying its marker and links to it", async () => {
    const sent: unknown[] = [];
    const target = notionPlanTarget(destination, "ws", {
      publish: async (input, _workspace, beforeSend) => {
        beforeSend();
        sent.push(input);
        return { state: "created", pageId: page };
      },
      locate: async () => undefined,
    });
    expect(
      await target.write({ ...item({ body: "Hello" }), destination: "notion" }),
    ).toEqual({
      externalId: page,
      url: "https://www.notion.so/11111111222243338444555555555555",
    });
    expect(sent[0]).toMatchObject({
      parentId: destination.parentId,
      title: "Invite <10> testers",
      text: "Hello\n\nAmun publication ID: 3b0f6a52-58a5-4c0e-9d3e-6f7a1f1f0c11",
    });
  });
  it("separates a request that never left from an unconfirmed one", async () => {
    const offline = notionPlanTarget(destination, "ws", {
      publish: async () => {
        throw Error("Reconnect Notion before publication");
      },
      locate: async () => undefined,
    });
    await expect(offline.write(item())).rejects.toBeInstanceOf(PlanNotSent);
    const lost = notionPlanTarget(destination, "ws", {
      publish: async (_input, _workspace, beforeSend) => {
        beforeSend();
        return { state: "unknown" };
      },
      locate: async () => undefined,
    });
    const failure = await lost.write(item()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(PlanNotSent);
  });
  it("does not treat a search miss under a page as proof of absence", async () => {
    const target = notionPlanTarget(destination, "ws", {
      publish: async () => ({ state: "unknown" }),
      locate: async () => undefined,
    });
    await expect(target.find(item())).rejects.toThrow();
    const found = notionPlanTarget(destination, "ws", {
      publish: async () => ({ state: "unknown" }),
      locate: async () => page,
    });
    expect((await found.find(item()))?.externalId).toBe(page);
  });
});
