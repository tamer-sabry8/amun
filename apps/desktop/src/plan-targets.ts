// Destinations for an approved plan (packages/data/src/plan-publication.ts).
// Each adapter reuses the existing governed writer for its service; nothing
// here opens a connection or stores a credential.
import type { AzureProcessSchema } from "../../../packages/contracts/src/backlog.ts";
import type { AdoStep } from "../../../packages/data/src/ado-batch.ts";
import {
  PlanNotSent,
  type PlanTarget,
  type PlanWriteItem,
} from "../../../packages/data/src/plan-publication.ts";
import type {
  NotionPublication,
  NotionResult,
} from "../../../packages/connectors-notion/src/client.ts";
import type { NotionDestination } from "../../../packages/auth/src/notion-result.ts";

const storyTypes = [
  "User Story",
  "Product Backlog Item",
  "Requirement",
  "Issue",
];
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** The exact Azure work item a plan item becomes. Same input, same step. */
export function adoStep(
  item: PlanWriteItem,
  schema: AzureProcessSchema,
  project: string,
): AdoStep {
  const wanted = text(item.fields.type);
  const type = wanted
    ? schema.types.find(
        (entry) => entry.name.toLowerCase() === wanted.toLowerCase(),
      )
    : storyTypes
        .map((name) => schema.types.find((entry) => entry.name === name))
        .find((entry) => entry);
  if (!type)
    throw new PlanNotSent(
      wanted
        ? `“${wanted}” is not a work item type in ${project}.`
        : `${project} has no story work item type.`,
    );
  const has = (name: string) =>
    type.fields.some((field) => field.referenceName === name);
  const fields: AdoStep["fields"] = { "System.Title": item.summary };
  const description = text(item.fields.description);
  if (description && has("System.Description"))
    fields["System.Description"] = "<p>" + escape(description) + "</p>";
  const acceptance = text(item.fields.acceptance);
  if (acceptance && has("Microsoft.VSTS.Common.AcceptanceCriteria"))
    fields["Microsoft.VSTS.Common.AcceptanceCriteria"] =
      "<ul>" +
      acceptance
        .split(/\n+/)
        .map((line) => "<li>" + escape(line.trim()) + "</li>")
        .join("") +
      "</ul>";
  const area = text(item.fields.area);
  if (area) {
    if (!schema.areas.includes(area))
      throw new PlanNotSent(`“${area}” is not an area path in ${project}.`);
    fields["System.AreaPath"] = area;
  }
  const iteration = text(item.fields.iteration);
  if (iteration) {
    if (!schema.iterations.includes(iteration))
      throw new PlanNotSent(
        `“${iteration}” is not an iteration in ${project}.`,
      );
    fields["System.IterationPath"] = iteration;
  }
  return {
    itemId: item.id,
    parentId: null,
    remoteId: null,
    revision: 0,
    // Azure tags accept letters, digits and hyphens.
    marker: "Amun-" + item.marker,
    type: type.name,
    fields,
  };
}

export function adoPlanTarget(
  collection: string,
  project: string,
  reader: { processSchema(): Promise<AzureProcessSchema> },
  client: {
    write(step: AdoStep, parent: null): Promise<{ id: number }>;
    find(step: AdoStep, parent: null): Promise<{ id: number } | undefined>;
  },
): PlanTarget {
  const receipt = (id: number) => ({
    externalId: String(id),
    url: `${collection}${encodeURIComponent(project)}/_workitems/edit/${id}`,
  });
  let schema: Promise<AzureProcessSchema> | undefined;
  const step = async (item: PlanWriteItem) =>
    adoStep(item, await (schema ??= reader.processSchema()), project);
  return {
    async write(item) {
      let prepared: AdoStep;
      try {
        prepared = await step(item);
      } catch (error) {
        // Reading the project failed or the item does not fit it: unsent.
        throw error instanceof PlanNotSent
          ? error
          : new PlanNotSent("Azure DevOps could not be read.");
      }
      return receipt((await client.write(prepared, null)).id);
    },
    async find(item) {
      const found = await client.find(await step(item), null);
      return found ? receipt(found.id) : undefined;
    },
  };
}

export function notionPlanTarget(
  destination: NotionDestination,
  workspaceId: string,
  connection: {
    publish(
      input: NotionPublication,
      workspaceId: string,
      beforeSend: () => void,
    ): Promise<NotionResult>;
    locate(
      intent: {
        marker: string;
        parentId: string;
        parentType: "page_id" | "data_source_id";
        property?: boolean;
      },
      workspaceId: string,
    ): Promise<string | undefined>;
  },
): PlanTarget {
  const property =
    destination.parentType === "data_source_id" &&
    destination.markerPropertyAvailable === true;
  const receipt = (pageId: string) => ({
    externalId: pageId,
    url: "https://www.notion.so/" + pageId.replaceAll("-", ""),
  });
  return {
    async write(item) {
      const body =
        text(item.fields.body) ?? text(item.fields.description) ?? item.summary;
      let sent = false;
      let result: NotionResult;
      try {
        result = await connection.publish(
          {
            parentId: destination.parentId,
            parentType: destination.parentType,
            titleProperty: destination.titleProperty,
            title: item.summary,
            text: property
              ? body
              : body + "\n\nAmun publication ID: " + item.marker,
            ...(property ? { markerPropertyId: item.marker } : {}),
          },
          workspaceId,
          () => {
            sent = true;
          },
        );
      } catch (error) {
        if (sent) throw error;
        throw new PlanNotSent(
          error instanceof Error && /reconnect/i.test(error.message)
            ? "Reconnect Notion in Settings, then retry."
            : "Notion could not be reached. Nothing was sent.",
        );
      }
      if (result.state !== "created") {
        if (!sent) throw new PlanNotSent("Notion did not accept the page.");
        throw Error("Notion did not confirm the page.");
      }
      return receipt(result.pageId);
    },
    async find(item) {
      const pageId = await connection.locate(
        {
          marker: item.marker,
          parentId: destination.parentId,
          parentType: destination.parentType,
          property,
        },
        workspaceId,
      );
      if (pageId) return receipt(pageId);
      // A database row is queried by its marker property: absent is absent.
      if (property) return undefined;
      // Notion's search can lag a new page, so "not found" here is not proof
      // of absence. Stay uncertain rather than risk a duplicate page.
      throw Error("Notion has not confirmed whether the page exists.");
    },
  };
}
