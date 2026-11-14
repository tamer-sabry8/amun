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
import {
  uuidFromReference,
  type NotionDestination,
} from "../../../packages/auth/src/notion-result.ts";

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

// The plan's field names as written by people or models ("Acceptance
// criteria", "Work item type") mapped to the names this adapter uses. Any
// other field with a value, such as "Assigned to" or "Estimate", is refused
// instead of being dropped; blank ones are ignored.
const fieldNames: Record<string, string> = {
  title: "title",
  description: "description",
  body: "description",
  acceptance: "acceptance",
  acceptancecriteria: "acceptance",
  type: "type",
  workitemtype: "type",
  area: "area",
  areapath: "area",
  iteration: "iteration",
  iterationpath: "iteration",
  project: "project",
  destination: "destination",
};
/** The project itself, or it under this connection's own collection. */
function ownProject(named: string, project: string, collection?: string) {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const clean = named.trim().replace(/\/+$/, "");
  if (same(clean, project)) return true;
  if (!collection) return false;
  const base = collection.replace(/\/+$/, "");
  const name = decodeURIComponent(base.split("/").at(-1) ?? "");
  return [`${name}/${project}`, `${base}/${project}`].some((own) =>
    same(clean, own),
  );
}

function planFields(item: PlanWriteItem, project: string, collection?: string) {
  const fields: Record<string, string> = {};
  const refused: string[] = [];
  for (const [label, raw] of Object.entries(item.fields)) {
    const value = text(raw === null ? null : String(raw));
    if (!value) continue;
    const key = label.toLowerCase().replace(/[^a-z0-9]/g, "");
    const name = fieldNames[key];
    if (!name) {
      refused.push(label);
      continue;
    }
    if (fields[name] !== undefined && fields[name] !== value)
      throw new PlanNotSent(`“${label}” conflicts with another ${name} value.`);
    fields[name] = value;
  }
  if (refused.length)
    throw new PlanNotSent(
      `Amun cannot send ${refused.map((name) => `“${name}”`).join(", ")} to Azure DevOps yet. Remove ${refused.length === 1 ? "it" : "them"} or leave ${refused.length === 1 ? "it" : "them"} blank.`,
    );
  if (fields.title && fields.title !== item.summary.trim())
    throw new PlanNotSent("The title in the fields differs from the title.");
  const named = fields.project;
  if (named && !ownProject(named, project, collection))
    throw new PlanNotSent(`“${named}” is not the project ${project}.`);
  return fields;
}

/** The exact Azure work item a plan item becomes. Same input, same step. */
export function adoStep(
  item: PlanWriteItem,
  schema: AzureProcessSchema,
  project: string,
  collection?: string,
): AdoStep {
  const supplied = planFields(item, project, collection);
  const wanted = supplied.type ?? null;
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
  const require = (name: string, label: string) => {
    if (!has(name))
      throw new PlanNotSent(
        `${type.name} in ${project} has no ${label} field, so it would be lost.`,
      );
  };
  const fields: AdoStep["fields"] = { "System.Title": item.summary };
  const description = supplied.description ?? null;
  if (description) {
    require("System.Description", "Description");
    fields["System.Description"] = "<p>" + escape(description) + "</p>";
  }
  const acceptance = supplied.acceptance ?? null;
  if (acceptance) {
    require("Microsoft.VSTS.Common.AcceptanceCriteria", "Acceptance criteria");
    fields["Microsoft.VSTS.Common.AcceptanceCriteria"] =
      "<ul>" +
      acceptance
        .split(/\n+/)
        .flatMap((line) =>
          /^1[.)]\s/.test(line) ? line.split(/\s+(?=\d+[.)]\s)/) : [line],
        )
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => "<li>" + escape(line) + "</li>")
        .join("") +
      "</ul>";
  }
  const area = supplied.area ?? null;
  if (area) {
    if (!schema.areas.includes(area))
      throw new PlanNotSent(`“${area}” is not an area path in ${project}.`);
    fields["System.AreaPath"] = area;
  }
  const iteration = supplied.iteration ?? null;
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
    adoStep(
      item,
      await (schema ??= reader.processSchema()),
      project,
      collection,
    );
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

const notionNames: Record<string, string> = {
  title: "title",
  body: "body",
  description: "body",
  parentpageid: "parent",
  parentid: "parent",
  parent: "parent",
  destination: "destination",
};

/**
 * The page a plan item becomes. The reviewed Title is the page title (the
 * item summary describes the action); the parent may only repeat the
 * connector-verified destination, never change it. Anything else with a
 * value is refused instead of being dropped.
 */
function notionPage(item: PlanWriteItem, destination: NotionDestination) {
  const fields: Record<string, string> = {};
  const refused: string[] = [];
  for (const [label, raw] of Object.entries(item.fields)) {
    const value = text(raw === null ? null : String(raw));
    if (!value) continue;
    const name = notionNames[label.toLowerCase().replace(/[^a-z0-9]/g, "")];
    if (!name) {
      refused.push(label);
      continue;
    }
    if (fields[name] !== undefined && fields[name] !== value)
      throw new PlanNotSent(`“${label}” conflicts with another ${name} value.`);
    fields[name] = value;
  }
  if (refused.length)
    throw new PlanNotSent(
      `Amun cannot send ${refused.map((name) => `“${name}”`).join(", ")} to Notion yet. Remove them or leave them blank.`,
    );
  if (fields.parent) {
    let parent: string | null = null;
    try {
      parent = uuidFromReference(fields.parent);
    } catch {
      // Reported below with the other mismatches.
    }
    if (parent !== uuidFromReference(destination.parentId))
      throw new PlanNotSent(
        "The parent page differs from the connected Notion destination.",
      );
  }
  const title = fields.title ?? item.summary;
  return { title, body: fields.body ?? title };
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
      const page = notionPage(item, destination);
      const body = page.body;
      let sent = false;
      let result: NotionResult;
      try {
        result = await connection.publish(
          {
            parentId: destination.parentId,
            parentType: destination.parentType,
            titleProperty: destination.titleProperty,
            title: page.title,
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
