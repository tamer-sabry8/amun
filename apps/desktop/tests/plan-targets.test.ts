import { describe, expect, it } from "vitest";
import {
  adoPlanTarget,
  adoStep,
  adoUpdate,
  adoUpdateChange,
  resolveAdoTypes,
  claimsNotionPageUpdate,
  localClaimRefusalEvent,
  localPlanRefusal,
  notionUpdateRefusal,
  notionChangedNote,
  notionUpdateRefusalEvent,
  notionPlanTarget,
} from "../src/plan-targets.ts";
import { AdoTypeMissing } from "../../../packages/connectors-ado/src/governed-writes.ts";
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
  it("reads the labelled fields a model writes, not only the short names", () => {
    const step = adoStep(
      item({
        "Work item type": "Product Backlog Item",
        Project: "TahalufCollection/POCs",
        Title: "Invite <10> testers",
        Description: "Synthetic record.",
        "Acceptance criteria": "1. Created once. 2. Shows its ID.",
        "Assigned to": "",
        Iteration: "POCs\\Sprint 1",
        Estimate: "",
      }),
      schema,
      "POCs",
      "https://devops.example/TahalufCollection/",
    );
    expect(step.fields).toEqual({
      "System.Title": "Invite <10> testers",
      "System.Description": "<p>Synthetic record.</p>",
      "Microsoft.VSTS.Common.AcceptanceCriteria":
        "<ul><li>1. Created once.</li><li>2. Shows its ID.</li></ul>",
      "System.IterationPath": "POCs\\Sprint 1",
    });
  });
  it("accepts only this connection's own project name", async () => {
    const own = "https://devops.example/Collection/";
    for (const Project of [
      "POCs",
      "Collection/POCs",
      "https://devops.example/Collection/POCs",
    ])
      expect(() =>
        adoStep(item({ Project }), schema, "POCs", own),
      ).not.toThrow();
    for (const Project of [
      "Other/POCs",
      "https://other.example/Collection/POCs",
      "Elsewhere/Collection/POCs",
    ])
      expect(() => adoStep(item({ Project }), schema, "POCs", own)).toThrow(
        PlanNotSent,
      );
    expect(() =>
      adoStep(item({ Project: "Collection/POCs" }), schema, "POCs"),
    ).toThrow(PlanNotSent);
    let writes = 0;
    const target = adoPlanTarget(
      own,
      "POCs",
      { processSchema: async () => schema },
      {
        write: async () => {
          writes += 1;
          return { id: 1 };
        },
        find: async () => undefined,
      },
    );
    await expect(
      target.write(item({ Project: "Foreign/POCs" })),
    ).rejects.toBeInstanceOf(PlanNotSent);
    expect(writes).toBe(0);
  });
  it("refuses a value that would be dropped instead of dropping it", () => {
    for (const fields of [
      { "Assigned to": "Tamer" },
      { Estimate: "5" },
      { "Story points": 3 },
      { Project: "Other" },
      { Project: "Foreign/POCs" },
      { Title: "A different title" },
      { Description: "One", body: "Two" },
    ])
      expect(() => adoStep(item(fields), schema, "POCs")).toThrow(PlanNotSent);
    const noDescription = {
      ...schema,
      types: [{ name: "Bug", fields: [field("System.Title")] }],
    } as unknown as AzureProcessSchema;
    expect(() =>
      adoStep(
        item({ type: "Bug", Description: "Lost?" }),
        noDescription,
        "POCs",
      ),
    ).toThrow(/no Description field/);
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

const process = (process: string, ...names: string[]) =>
  ({
    process,
    areas: ["POCs"],
    iterations: ["POCs"],
    types: names.map((name) => ({
      name,
      fields: [field("System.Title"), field("System.Description")],
    })),
  }) as unknown as AzureProcessSchema;
const processes = [
  ["Scrum", "Product Backlog Item"],
  ["Agile", "User Story"],
  ["Basic", "Issue"],
  ["CMMI", "Requirement"],
] as const;

describe("Azure DevOps work item types by process", () => {
  it.each(processes)(
    "%s: a generic story name becomes the project's own %s",
    (name, story) => {
      const only = process(name, "Bug", "Task", story);
      expect(adoStep(item(), only, "POCs").type).toBe(story);
      expect(adoStep(item({ type: "User Story" }), only, "POCs").type).toBe(
        story,
      );
      expect(adoStep(item({ type: "Sub-task" }), only, "POCs").type).toBe(
        "Task",
      );
    },
  );
  it("prefers the team's backlog configuration over the process name", () => {
    const both = process("Agile", "User Story", "Product Backlog Item", "Task");
    expect(resolveAdoTypes(both, { story: "Product Backlog Item" }).story).toBe(
      "Product Backlog Item",
    );
    expect(
      resolveAdoTypes(both, undefined, { story: "Product Backlog Item" }).story,
    ).toBe("Product Backlog Item");
    expect(resolveAdoTypes(both).story).toBe("User Story");
  });
  it("keeps a type the project has and refuses an unknown one", () => {
    const scrum = process("Scrum", "Product Backlog Item", "Bug", "Task");
    expect(adoStep(item({ type: "Bug" }), scrum, "POCs").type).toBe("Bug");
    expect(() => adoStep(item({ type: "Epic" }), scrum, "POCs")).toThrow(
      PlanNotSent,
    );
  });
});

describe("Azure DevOps rejected work item type", () => {
  // The cached schema still claims "User Story" exists; Azure says it does not.
  const stale = process("Agile", "User Story", "Product Backlog Item", "Task");
  // Learned from an earlier plan, so the first attempt uses the stale type.
  const make = (
    write: (type: string) => Promise<{ id: number }>,
    found = false,
  ) => {
    const sent: { type: string; marker: string; fields: unknown }[] = [];
    const learned: unknown[] = [];
    const target = adoPlanTarget(
      "https://devops.example/Collection/",
      "POCs",
      { processSchema: async () => stale },
      {
        write: async (step) => {
          sent.push(step);
          return write(step.type);
        },
        find: async () => (found ? { id: 99 } : undefined),
      },
      {
        backlog: async () => ({ story: "Product Backlog Item" }),
        learned: () => ({ story: "User Story" }),
        learn: (names) => learned.push(names),
      },
    );
    return { target, sent, learned };
  };
  const planned = () => item({ type: "User Story", description: "Why" });
  const reject = (type: string) => {
    if (type === "User Story") throw new AdoTypeMissing("rejected");
    return Promise.resolve({ id: 7 });
  };

  it("retries once with the project's story type and says so", async () => {
    const { target, sent, learned } = make(async (type) => reject(type));
    const receipt = await target.write(planned());
    expect(receipt.externalId).toBe("7");
    expect(receipt.note).toMatch(/User Story.*Product Backlog Item/);
    expect(sent.map((step) => step.type)).toEqual([
      "User Story",
      "Product Backlog Item",
    ]);
    expect(sent[1]?.marker).toBe(sent[0]?.marker);
    expect(sent[1]?.fields).toEqual(sent[0]?.fields);
    expect(learned.at(-1)).toMatchObject({ story: "Product Backlog Item" });
  });
  it("does not retry any other failure", async () => {
    const { target, sent } = make(async () => {
      throw Error("request_rejected_400");
    });
    await expect(target.write(planned())).rejects.toThrow(
      "request_rejected_400",
    );
    expect(sent).toHaveLength(1);
  });
  it("retries at most once", async () => {
    const sent: string[] = [];
    const target = adoPlanTarget(
      "https://devops.example/Collection/",
      "POCs",
      { processSchema: async () => stale },
      {
        write: async (step) => {
          sent.push(step.type);
          throw new AdoTypeMissing("always");
        },
        find: async () => undefined,
      },
      {
        backlog: async () => ({ story: "Product Backlog Item" }),
        learned: () => ({ story: "User Story" }),
      },
    );
    await expect(target.write(planned())).rejects.toBeInstanceOf(
      AdoTypeMissing,
    );
    expect(sent).toEqual(["User Story", "Product Backlog Item"]);
  });
  it("links an item that already exists instead of creating it again", async () => {
    const sent: string[] = [];
    const target = adoPlanTarget(
      "https://devops.example/Collection/",
      "POCs",
      { processSchema: async () => stale },
      {
        write: async (step) => {
          sent.push(step.type);
          throw new AdoTypeMissing("x");
        },
        find: async () => ({ id: 99 }),
      },
      {
        backlog: async () => ({ story: "Product Backlog Item" }),
        learned: () => ({ story: "User Story" }),
      },
    );
    expect((await target.write(planned())).externalId).toBe("99");
    expect(sent).toEqual(["User Story"]);
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
  it("publishes the reviewed title and body from labelled fields", async () => {
    const sent: { title: string; text: string }[] = [];
    const target = notionPlanTarget(destination, "ws", {
      publish: async (input, _workspace, beforeSend) => {
        beforeSend();
        sent.push(input);
        return { state: "created", pageId: page };
      },
      locate: async () => undefined,
    });
    await target.write({
      ...item({
        ParentPageId: destination.parentId.replaceAll("-", "").toUpperCase(),
        Title: "QA Smoke",
        Body: "Synthetic page.",
      }),
      summary: "Create page QA Smoke",
      destination: "notion",
    });
    expect(sent[0]).toMatchObject({ title: "QA Smoke" });
    expect(sent[0]!.text).toMatch(/^Synthetic page\.\n\nAmun publication ID/);
  });
  it("refuses a different parent or an unsupported field without sending", async () => {
    let calls = 0;
    const target = notionPlanTarget(destination, "ws", {
      publish: async () => {
        calls += 1;
        return { state: "created", pageId: page };
      },
      locate: async () => undefined,
    });
    for (const fields of [
      { ParentPageId: "22222222222243338444555555555555" },
      { parent: "not an id" },
      { Icon: "rocket" },
      { Body: "One", description: "Two" },
    ])
      await expect(
        target.write({ ...item(fields), destination: "notion" }),
      ).rejects.toBeInstanceOf(PlanNotSent);
    expect(calls).toBe(0);
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

describe("Notion page update claims", () => {
  const plan = (summary: string, fields = {}, itemSummary = "QA page") => ({
    summary,
    items: [{ summary: itemSummary, fields }],
  });
  it("refuses the incident wording", () => {
    expect(
      claimsNotionPageUpdate(
        plan(
          "Update the existing Notion page QA-20261114. Edits the existing page only; no new page is created",
        ),
      ),
    ).toBe(true);
  });
  it("refuses re-sync, edit and page-reference fields", () => {
    expect(claimsNotionPageUpdate(plan("Re-sync QA notes"))).toBe(true);
    expect(claimsNotionPageUpdate(plan("Notes", {}, "Edit the page"))).toBe(
      true,
    );
    expect(claimsNotionPageUpdate(plan("Notes", { "Page ID": "abc" }))).toBe(
      true,
    );
  });
  it("allows ordinary new-page plans", () => {
    expect(
      claimsNotionPageUpdate(plan("Publish QA summary", { body: "Hello" })),
    ).toBe(false);
    expect(claimsNotionPageUpdate(plan("Add a page", { "Page ID": "" }))).toBe(
      false,
    );
  });
  it("does not scan body text, only titles and page references", () => {
    expect(
      claimsNotionPageUpdate(
        plan("Publish QA notes", {
          body: "We will re-sync later and edit the page by hand",
          description: "Update the existing page",
        }),
      ),
    ).toBe(false);
    expect(
      claimsNotionPageUpdate(plan("Notes", { Title: "Re-sync QA notes" })),
    ).toBe(true);
  });
  it("refuses an incident-style Notion plan and tolerates missing items", () => {
    const summary =
      "Update the existing Notion page QA-20261114. Edits the existing page only; no new page is created";
    const event = notionUpdateRefusalEvent({
      action: "propose-plan",
      destination: "notion",
      summary,
      items: [{ summary: "QA page", fields: {} }],
    });
    expect(event).toMatchObject({ ok: false, message: notionUpdateRefusal });
    expect(
      notionUpdateRefusalEvent(
        { action: "update-plan" },
        { destination: "notion", summary },
      ),
    ).toMatchObject({ ok: false, message: notionUpdateRefusal });
    expect(
      notionUpdateRefusalEvent({
        action: "propose-plan",
        destination: "ado",
        summary,
        items: [],
      }),
    ).toBeNull();
  });
});

describe("local-only requests", () => {
  const notion = {
    action: "propose-plan",
    destination: "notion",
    summary: "Two QA stories",
    items: [{ fields: {} }],
  };
  const ado = { ...notion, destination: "ado" };
  it("refuses an external plan when the owner asked for local only", () => {
    for (const ask of [
      "Add two local QA stories. Do not change Azure DevOps.",
      "Keep it local",
      "local only please",
      "Create the stories locally",
      "Only in Amun",
      "don't change Notion",
    ])
      expect(localClaimRefusalEvent(notion, ask)).toMatchObject({
        ok: false,
        message: localPlanRefusal,
      });
  });
  it("refuses only when the forbidden service is the plan's destination", () => {
    expect(
      localClaimRefusalEvent(ado, "Do not change Azure DevOps"),
    ).toMatchObject({ ok: false });
    expect(
      localClaimRefusalEvent(notion, "Do not change Azure DevOps"),
    ).toBeNull();
  });
  it("allows approval-gated wording", () => {
    for (const ask of [
      "Propose them only; do not publish anywhere yet.",
      "Prepare a separate review-and-publish plan for the stories. Do not publish until I approve the plan separately.",
      "Don't send yet, preview only",
    ])
      expect(localClaimRefusalEvent(ado, ask)).toBeNull();
    expect(
      localClaimRefusalEvent(
        { ...ado, summary: "Nothing is published until you approve" },
        "Add stories",
      ),
    ).toBeNull();
  });
  it("refuses an external plan whose summary claims local", () => {
    expect(
      localClaimRefusalEvent(
        { ...notion, summary: "Local sprint plan" },
        "Add stories",
      ),
    ).not.toBeNull();
    expect(
      localClaimRefusalEvent(
        {
          ...notion,
          summary: "Local draft sprint for QA. Not for Azure DevOps.",
        },
        "Add stories",
      ),
    ).not.toBeNull();
    expect(
      localClaimRefusalEvent(
        { ...notion, summary: "Stays in Amun" },
        "Add stories",
      ),
    ).not.toBeNull();
  });
  it("allows ordinary external plans and local destinations", () => {
    expect(localClaimRefusalEvent(notion, "Publish this to Notion")).toBeNull();
    expect(
      localClaimRefusalEvent(
        { ...notion, destination: "amun" },
        "keep it local",
      ),
    ).toBeNull();
  });
});

describe("looking for an Azure item Amun already created", () => {
  it("asks for the exact title under every story type, the resolved one first", async () => {
    const asked: (string | string[])[][] = [];
    const target = adoPlanTarget(
      "https://devops.example/Collection/",
      "POCs",
      { processSchema: async () => schema },
      {
        write: async () => ({ id: 1 }),
        find: async () => undefined,
        existing: async (title, type) => {
          asked.push([title, type]);
          return { id: 1091018 };
        },
      },
    );
    expect(await target.existing?.(item({}))).toEqual({
      externalId: "1091018",
      url: "https://devops.example/Collection/POCs/_workitems/edit/1091018",
    });
    expect(asked).toEqual([
      [
        "Invite <10> testers",
        ["Product Backlog Item", "User Story", "Requirement", "Issue"],
      ],
    ]);
  });
});

describe("Notion page updates", () => {
  const pageId = "11111111-2222-4333-8444-555555555555";
  const destination = {
    title: "test for Amun to use",
    parentId: "41735810-e3a9-80ea-ae45-d78ca230f0a3",
    parentType: "page_id" as const,
    titleProperty: "title",
  };
  const update = (fields: Record<string, string> = {}) => ({
    id: "i1",
    summary: "Update Notion page: QA notes",
    marker: "m-2",
    destination: "notion",
    fields: { page: pageId, title: "QA notes", body: "New", ...fields },
  });
  const receipt = { marker: "m-1", version: "v1", url: null };
  const connection = (outcome: object, sent: string[] = []) => ({
    publish: async () => ({ state: "unknown" as const }),
    locate: async () => undefined,
    updatePage: async (
      input: { expectedVersion: string; text: string },
      _workspace: string,
      beforeSend: () => void,
    ) => {
      sent.push(input.expectedVersion + ":" + input.text);
      if ((outcome as { state: string }).state === "updated") beforeSend();
      return outcome as never;
    },
  });
  const own = (id: string) => (id === pageId ? receipt : undefined);

  it("allows a plan that updates a page Amun created, and only that", () => {
    const proposal = (page: string) => ({
      action: "propose-plan",
      destination: "notion",
      summary: "Update the existing Notion page",
      items: [{ summary: "QA notes", fields: { page } }],
    });
    expect(
      notionUpdateRefusalEvent(
        proposal(pageId),
        undefined,
        (id) => id === pageId,
      ),
    ).toBeNull();
    expect(
      notionUpdateRefusalEvent(
        proposal("99999999-2222-4333-8444-555555555555"),
        undefined,
        (id) => id === pageId,
      ),
    ).toMatchObject({ ok: false, message: notionUpdateRefusal });
    expect(notionUpdateRefusalEvent(proposal(pageId))).toMatchObject({
      ok: false,
    });
  });

  it("updates with the version Amun recorded and reports the new one", async () => {
    const sent: string[] = [];
    const target = notionPlanTarget(
      destination,
      "ws",
      connection({ state: "updated", version: "v2" }, sent),
      own,
    );
    expect(await target.write(update())).toMatchObject({
      externalId: pageId,
      updated: true,
      version: "v2",
    });
    expect(sent).toEqual(["v1:New"]);
  });

  it("stops with the newer page's link when it changed in Notion", async () => {
    const target = notionPlanTarget(
      destination,
      "ws",
      connection({ state: "changed", url: "https://www.notion.so/abc" }),
      own,
    );
    const failure = await target
      .write(update())
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      message: notionChangedNote,
      url: "https://www.notion.so/abc",
    });
    expect(failure).toBeInstanceOf(PlanNotSent);
  });

  it("refuses pages Amun did not create, or never recorded, before reaching Notion", async () => {
    const sent: string[] = [];
    const target = (receipts: Parameters<typeof notionPlanTarget>[3]) =>
      notionPlanTarget(
        destination,
        "ws",
        connection({ state: "updated", version: "v2" }, sent),
        receipts,
      );
    await expect(
      target(() => undefined).write(update()),
    ).rejects.toBeInstanceOf(PlanNotSent);
    await expect(
      target(() => ({ ...receipt, version: null })).write(update()),
    ).rejects.toBeInstanceOf(PlanNotSent);
    await expect(
      target(own).write(update({ body: "" })),
    ).rejects.toBeInstanceOf(PlanNotSent);
    expect(sent).toEqual([]);
  });
});

describe("Azure DevOps existing work item updates", () => {
  const update = (fields: Record<string, string | number | null>) =>
    item({ workitem: 42, ...fields });
  const now = (fields: Record<string, unknown> = {}) => ({
    id: 42,
    rev: 7,
    fields: {
      "System.Title": "Login",
      "System.WorkItemType": "Bug",
      ...fields,
    },
  });
  const target = (
    read: () => Promise<ReturnType<typeof now>>,
    write: (step: unknown) => Promise<{ id: number }>,
  ) =>
    adoPlanTarget(
      "https://devops.example/Collection/",
      "POCs",
      { processSchema: async () => schema },
      { write: write as never, find: async () => undefined, item: read },
    );

  it("allows only Assigned to and Iteration path on an existing item", () => {
    expect(
      adoUpdate(
        update({ iteration: "POCs\\Sprint 1", "Assigned to": "Sam" }),
        schema,
        "POCs",
      ),
    ).toEqual({
      id: 42,
      fields: {
        "System.IterationPath": "POCs\\Sprint 1",
        "System.AssignedTo": "Sam",
      },
    });
    expect(() => adoUpdate(update({ title: "New" }), schema, "POCs")).toThrow(
      PlanNotSent,
    );
    expect(() => adoUpdate(update({}), schema, "POCs")).toThrow(PlanNotSent);
    expect(() =>
      adoUpdate(update({ iteration: "POCs\\Nope" }), schema, "POCs"),
    ).toThrow(PlanNotSent);
  });
  it("still refuses Assigned to on a new item", () => {
    expect(() =>
      adoStep(item({ "Assigned to": "Tamer" }), schema, "POCs"),
    ).toThrow(PlanNotSent);
  });
  it("shows the exact before and after", () => {
    const lines = adoUpdateChange(now(), { "System.AssignedTo": "Sam" });
    expect(lines.map((line) => line.text ?? JSON.stringify(line))).toEqual(
      expect.arrayContaining([expect.stringContaining("Sam")]),
    );
  });
  it("writes against the revision it read and links the item", async () => {
    let sent: { remoteId?: number; revision?: number } = {};
    const result = await target(
      async () => now(),
      async (step) => {
        sent = step as typeof sent;
        return { id: 42 };
      },
    ).write(update({ iteration: "POCs\\Sprint 1" }));
    expect(sent).toMatchObject({ remoteId: 42, revision: 7 });
    expect(result).toMatchObject({ externalId: "42", updated: true });
  });
  it("does not write what is already set", async () => {
    const result = await target(
      async () => now({ "System.IterationPath": "POCs\\Sprint 1" }),
      async () => {
        throw Error("must not write");
      },
    ).write(update({ iteration: "POCs\\Sprint 1" }));
    expect(result).toMatchObject({ updated: true });
  });
  it("reports a changed item or a refused value as unsent", async () => {
    for (const reason of ["revision_conflict", "request_rejected_400"])
      await expect(
        target(
          async () => now(),
          async () => {
            throw Error(reason);
          },
        ).write(update({ iteration: "POCs\\Sprint 1" })),
      ).rejects.toBeInstanceOf(PlanNotSent);
    await expect(
      target(
        async () => now(),
        async () => {
          throw Error("socket hang up");
        },
      ).write(update({ iteration: "POCs\\Sprint 1" })),
    ).rejects.not.toBeInstanceOf(PlanNotSent);
  });
  it("finds an update only when the values are already there", async () => {
    const t = (fields: Record<string, unknown>) =>
      target(
        async () => now(fields),
        async () => ({ id: 1 }),
      ).find(update({ iteration: "POCs\\Sprint 1" }));
    expect(await t({})).toBeUndefined();
    expect(await t({ "System.IterationPath": "POCs\\Sprint 1" })).toMatchObject(
      {
        updated: true,
      },
    );
  });
});
