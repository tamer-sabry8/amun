// Destinations for an approved plan (packages/data/src/plan-publication.ts).
// Each adapter reuses the existing governed writer for its service; nothing
// here opens a connection or stores a credential.
import type { AzureProcessSchema } from "../../../packages/contracts/src/backlog.ts";
import type { AdoStep } from "../../../packages/data/src/ado-batch.ts";
import {
  PlanChanged,
  PlanNotSent,
  redactedError,
  refusalReason,
  type PlanTarget,
  type PlanWriteItem,
} from "../../../packages/data/src/plan-publication.ts";
import type {
  NotionPublication,
  NotionResult,
} from "../../../packages/connectors-notion/src/client.ts";
import {
  notionTargetReference,
  uuidFromReference,
  type NotionDestination,
} from "../../../packages/auth/src/notion-result.ts";
import {
  updatedContent,
  type NotionPageSnapshot,
  type NotionPageUpdate,
  type NotionUpdateOutcome,
} from "../../../packages/auth/src/notion-page-update.ts";

import {
  AdoTypeMissing,
  sameAdoField,
} from "../../../packages/connectors-ado/src/governed-writes.ts";
import { lineDiff } from "../../../packages/domain/src/notion-update.ts";
import {
  adoParentOf,
  adoWorkItemOf,
  isAdoItemReference,
  isAdoParentReference,
} from "../../../packages/domain/src/ado-update.ts";

const storyTypes = [
  "User Story",
  "Product Backlog Item",
  "Requirement",
  "Issue",
];
const storyAliases = [...storyTypes, "Story", "Backlog Item"].map((name) =>
  name.toLowerCase(),
);
const taskAliases = ["task", "sub-task", "subtask", "sub task"];
// What each built-in process calls its stories (Scrum PBI, Agile User Story,
// Basic Issue, CMMI Requirement); used only when the team's backlog
// configuration cannot be read.
const processStories: [RegExp, string][] = [
  [/scrum/i, "Product Backlog Item"],
  [/agile/i, "User Story"],
  [/basic/i, "Issue"],
  [/cmmi/i, "Requirement"],
];
/** The project's own work item types for a story and for its sub-tasks. */
export interface AdoTypeNames {
  story?: string | undefined;
  task?: string | undefined;
}
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Chooses the story and task type this project really has: the team's
 * backlog configuration first, then what Amun learned here before, then the
 * process template, then any known story type the project contains.
 */
export function resolveAdoTypes(
  schema: AzureProcessSchema,
  backlog?: AdoTypeNames,
  learned?: AdoTypeNames,
): AdoTypeNames {
  const has = (name?: string) =>
    name
      ? schema.types.find((entry) => sameName(entry.name, name))?.name
      : undefined;
  const process = schema.process ?? "";
  return {
    story: [
      backlog?.story,
      learned?.story,
      processStories.find(([pattern]) => pattern.test(process))?.[1],
      ...storyTypes,
    ]
      .map(has)
      .find(Boolean),
    task: [backlog?.task, learned?.task, "Task"].map(has).find(Boolean),
  };
}
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

// Accepted only on an item that names an existing work item to update.
const assigneeNames = new Set(["assignedto", "assignee"]);
const updateAllowed = new Set([
  "item",
  "assignee",
  "iteration",
  "project",
  "destination",
]);

function planFields(item: PlanWriteItem, project: string, collection?: string) {
  const fields: Record<string, string> = {};
  const refused: string[] = [];
  const update = adoWorkItemOf(item.fields).named;
  for (const [label, raw] of Object.entries(item.fields)) {
    const value = text(raw === null ? null : String(raw));
    if (!value) continue;
    const key = label.toLowerCase().replace(/[^a-z0-9]/g, "");
    const name = isAdoItemReference(label)
      ? "item"
      : isAdoParentReference(label)
        ? "parent"
        : update && assigneeNames.has(key)
          ? "assignee"
          : fieldNames[key];
    if (!name || (update && !updateAllowed.has(name))) {
      refused.push(label);
      continue;
    }
    if (fields[name] !== undefined && fields[name] !== value)
      throw new PlanNotSent(`“${label}” conflicts with another ${name} value.`);
    fields[name] = value;
  }
  if (refused.length)
    throw new PlanNotSent(
      `${update ? "On an existing work item Amun can only change “Assigned to” and “Iteration path”. It cannot send" : "Amun cannot send"} ${refused.map((name) => `“${name}”`).join(", ")} to Azure DevOps${update ? "" : " yet"}. Remove ${refused.length === 1 ? "it" : "them"} or leave ${refused.length === 1 ? "it" : "them"} blank.`,
    );
  if (fields.title && fields.title !== item.summary.trim())
    throw new PlanNotSent("The title in the fields differs from the title.");
  if (fields.parent && !adoParentOf({ parent: fields.parent }).id)
    throw new PlanNotSent(
      `“${fields.parent}” is not an Azure DevOps work item number, so it cannot be the parent.`,
    );
  const named = fields.project;
  if (named && !ownProject(named, project, collection))
    throw new PlanNotSent(`“${named}” is not the project ${project}.`);
  return fields;
}

/**
 * The project's type for a planned type name, or for none: a generic story or
 * task name the project does not have means the project's own.
 */
export function pickAdoType(
  wanted: string | null,
  schema: AzureProcessSchema,
  names: AdoTypeNames,
) {
  const named = (name?: string) =>
    name ? schema.types.find((entry) => sameName(entry.name, name)) : undefined;
  if (!wanted) return named(names.story);
  return (
    named(wanted) ??
    (storyAliases.includes(wanted.toLowerCase())
      ? named(names.story)
      : taskAliases.includes(wanted.toLowerCase())
        ? named(names.task)
        : undefined)
  );
}

/** The exact Azure work item a plan item becomes. Same input, same step. */
export function adoStep(
  item: PlanWriteItem,
  schema: AzureProcessSchema,
  project: string,
  collection?: string,
  names: AdoTypeNames = resolveAdoTypes(schema),
  /** The type to use instead of the planned one, after Azure rejected it. */
  override?: string,
): AdoStep {
  if (adoWorkItemOf(item.fields).named)
    throw new PlanNotSent("This changes an existing work item, not a new one.");
  const supplied = planFields(item, project, collection);
  const wanted = override ?? supplied.type ?? null;
  const type = pickAdoType(wanted, schema, names);
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

/**
 * The exact change an update makes to an existing work item: the item, and
 * only its Assigned to and Iteration path. Same input, same change.
 */
export function adoUpdate(
  item: PlanWriteItem,
  schema: AzureProcessSchema,
  project: string,
  collection?: string,
) {
  const supplied = planFields(item, project, collection);
  const id = adoWorkItemOf(item.fields).id;
  if (!id)
    throw new PlanNotSent("That is not an Azure DevOps work item number.");
  const fields: Record<string, string> = {};
  if (supplied.assignee) {
    if (supplied.assignee.length > 256 || /[\r\n]/.test(supplied.assignee))
      throw new PlanNotSent("That is not a name Azure DevOps can use.");
    fields["System.AssignedTo"] = supplied.assignee;
  }
  if (supplied.iteration) {
    if (!schema.iterations.includes(supplied.iteration))
      throw new PlanNotSent(
        `“${supplied.iteration}” is not an iteration in ${project}.`,
      );
    fields["System.IterationPath"] = supplied.iteration;
  }
  if (!Object.keys(fields).length)
    throw new PlanNotSent(
      "Name an Assigned to or an Iteration path to change. Nothing was sent.",
    );
  return { id, fields };
}
const updateLabels: Record<string, string> = {
  "System.AssignedTo": "Assigned to",
  "System.IterationPath": "Iteration path",
};
/** The exact change on the review card: what is there now, what it becomes. */
export function adoUpdateChange(
  now: { id: number; fields: Record<string, unknown> },
  fields: Record<string, string>,
) {
  const shown = (key: string) => {
    const value = now.fields[key];
    return typeof value === "string"
      ? value
      : value &&
          typeof value === "object" &&
          typeof (value as { displayName?: unknown }).displayName === "string"
        ? (value as { displayName: string }).displayName
        : "Not set";
  };
  const head = `#${now.id} ${String(now.fields["System.Title"] ?? "")}`.trim();
  const entries = Object.entries(fields);
  return lineDiff(
    [
      head,
      ...entries.map(([key]) => `${updateLabels[key]}: ${shown(key)}`),
    ].join("\n"),
    [
      head,
      ...entries.map(([key, value]) => `${updateLabels[key]}: ${value}`),
    ].join("\n"),
  );
}
/** True when the work item already holds every approved value. */
const alreadySet = (
  now: { fields: Record<string, unknown> },
  fields: Record<string, string>,
) =>
  Object.entries(fields).every(([key, value]) =>
    sameAdoField(key, now.fields[key], value),
  );

export interface AdoTypeSource {
  /** The team's backlog configuration; a failed read falls back to the rest. */
  backlog?(): Promise<AdoTypeNames>;
  /** What Amun learned about this project before. */
  learned?(): AdoTypeNames | undefined;
  /** Remembers a mapping so later plans use it directly. */
  learn?(names: AdoTypeNames): void;
}

export function adoPlanTarget(
  collection: string,
  project: string,
  reader: { processSchema(): Promise<AzureProcessSchema> },
  client: {
    write(step: AdoStep, parent: number | null): Promise<{ id: number }>;
    find(
      step: AdoStep,
      parent: number | null,
    ): Promise<{ id: number } | undefined>;
    existing?(
      title: string,
      type: string | string[],
      parent?: number | null,
    ): Promise<{ id: number } | undefined>;
    item?(id: number): Promise<{
      id: number;
      rev: number;
      fields: Record<string, unknown>;
    }>;
  },
  types: AdoTypeSource = {},
): PlanTarget {
  const receipt = (id: number) => ({
    externalId: String(id),
    url: `${collection}${encodeURIComponent(project)}/_workitems/edit/${id}`,
  });
  let schema: Promise<AzureProcessSchema> | undefined;
  const read = () => (schema ??= reader.processSchema());
  const backlog = async () => {
    try {
      return (await types.backlog?.()) ?? undefined;
    } catch {
      return undefined;
    }
  };
  let names: Promise<AdoTypeNames> | undefined;
  const resolved = () =>
    (names ??= (async () => {
      const found = await backlog();
      const result = resolveAdoTypes(await read(), found, types.learned?.());
      if (found?.story) types.learn?.(result);
      return result;
    })());
  const step = async (item: PlanWriteItem, override?: string) =>
    adoStep(
      item,
      await read(),
      project,
      collection,
      await resolved(),
      override,
    );
  // Changes Assigned to and Iteration path on an item that already exists.
  // The write is conditional on the revision just read, so it can only apply
  // once; a lookup that finds the approved values already there links it.
  const change = async (item: PlanWriteItem) => {
    let planned: ReturnType<typeof adoUpdate>;
    try {
      planned = adoUpdate(item, await read(), project, collection);
    } catch (error) {
      throw error instanceof PlanNotSent
        ? error
        : new PlanNotSent("Azure DevOps could not be read.");
    }
    return planned;
  };
  const updated = (id: number) => ({ ...receipt(id), updated: true });
  const parentOf = (item: PlanWriteItem) => adoParentOf(item.fields).id;
  const under = (parent: number | null) =>
    parent ? `Linked under #${parent}.` : undefined;
  // The parent must be a real item in this project before anything is sent.
  const checkParent = async (parent: number | null) => {
    if (!parent || !client.item) return;
    try {
      await client.item(parent);
    } catch {
      throw new PlanNotSent(
        `Amun could not open #${parent} in ${project}, so nothing was created. Check the parent number.`,
      );
    }
  };
  return {
    async write(item) {
      if (adoWorkItemOf(item.fields).named) {
        const planned = await change(item);
        if (!client.item)
          throw new PlanNotSent("Azure DevOps could not be read.");
        let now: Awaited<ReturnType<NonNullable<typeof client.item>>>;
        try {
          now = await client.item(planned.id);
        } catch {
          throw new PlanNotSent(
            `Amun could not open #${planned.id} in ${project}. Nothing was changed.`,
          );
        }
        if (alreadySet(now, planned.fields)) return updated(planned.id);
        try {
          await client.write(
            {
              itemId: item.id,
              parentId: null,
              remoteId: planned.id,
              revision: now.rev,
              marker: "Amun-" + item.marker,
              type: String(now.fields["System.WorkItemType"] ?? ""),
              fields: planned.fields,
            },
            null,
          );
        } catch (error) {
          const reason = error instanceof Error ? error.message : "";
          if (reason === "revision_conflict")
            throw new PlanNotSent(
              `#${planned.id} changed in Azure DevOps a moment ago. Nothing was changed. Retry to use its latest version.`,
            );
          if (/^request_rejected_4\d\d$/.test(reason))
            throw new PlanNotSent(
              `Azure DevOps did not accept that change to #${planned.id}, for example a name it does not know. Nothing was changed.`,
            );
          throw error;
        }
        return updated(planned.id);
      }
      let prepared: AdoStep;
      try {
        prepared = await step(item);
      } catch (error) {
        // Reading the project failed or the item does not fit it: unsent.
        throw error instanceof PlanNotSent
          ? error
          : new PlanNotSent("Azure DevOps could not be read.");
      }
      const parent = parentOf(item);
      await checkParent(parent);
      try {
        const created = await client.write(prepared, parent);
        return { ...receipt(created.id), note: under(parent) };
      } catch (error) {
        // Only Azure saying the type is not in this project is retried, once,
        // with the project's own type: same fields and marker, so nothing can
        // be duplicated, and still under the owner's one approval.
        if (!(error instanceof AdoTypeMissing)) throw error;
        const isTask = taskAliases.includes(prepared.type.toLowerCase());
        const own = (await backlog())?.[isTask ? "task" : "story"];
        if (!own || sameName(own, prepared.type)) throw error;
        let retry: AdoStep;
        try {
          retry = await step(item, own);
        } catch {
          throw error;
        }
        const created =
          (await client.find(retry, parent)) ??
          (await client.write(retry, parent));
        const learned = types.learned?.() ?? {};
        types.learn?.({ ...learned, [isTask ? "task" : "story"]: own });
        return {
          ...receipt(created.id),
          note:
            `“${prepared.type}” is not a work item type in ${project}, so this was created as a ${own}.` +
            (parent ? ` ${under(parent)}` : ""),
        };
      }
    },
    async find(item) {
      if (adoWorkItemOf(item.fields).named) {
        const planned = await change(item);
        if (!client.item) throw Error("Azure DevOps could not be read.");
        const now = await client.item(planned.id);
        return alreadySet(now, planned.fields)
          ? updated(planned.id)
          : undefined;
      }
      const parent = parentOf(item);
      const found = await client.find(await step(item), parent);
      return found ? { ...receipt(found.id), note: under(parent) } : undefined;
    },
    async existing(item) {
      if (!client.existing || adoWorkItemOf(item.fields).named)
        return undefined;
      const prepared = await step(item);
      // A story may already exist under whichever story type the project
      // uses, so the type it was requested with is not the only one looked up.
      const family = storyAliases.includes(prepared.type.toLowerCase())
        ? [
            ...new Set([
              prepared.type,
              ...storyTypes,
              ...((await backlog())?.story ? [(await backlog())!.story!] : []),
            ]),
          ]
        : prepared.type;
      const found = await client.existing(
        String(prepared.fields["System.Title"]),
        family,
        parentOf(item),
      );
      return found ? receipt(found.id) : undefined;
    },
  };
}

export const notionUpdateRefusal =
  "Amun can only update a Notion page it created itself, and the plan has to name that page. Nothing was changed.";
export const notionChangedNote =
  "Changed in Notion since Amun last wrote it. Nothing was overwritten.";

/** The page a plan item names, as a bare id, or undefined. */
export function notionPageOf(fields: Record<string, unknown>) {
  for (const [key, value] of Object.entries(fields)) {
    if (!pageReference.has(key.toLowerCase().replace(/[^a-z0-9]/g, "")))
      continue;
    if (typeof value !== "string" || !value.trim()) continue;
    try {
      const text = value.trim();
      return uuidFromReference(
        /^https?:/i.test(text) ? notionTargetReference(text) : text,
      );
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const updateWording = [
  /\bexisting\s+(notion\s+)?page\b/,
  /\bno new page\b/,
  /\bre-?sync/,
  /\b(updates?|updating|edits?|editing|overwrites?|modif(?:y|ies)|amends?)\s+(the\s+|a\s+|an\s+)?(notion\s+)?page\b/,
];
const pageReference = new Set([
  "page",
  "pageid",
  "pageurl",
  "pagelink",
  "notionpage",
  "notionpageid",
  "notionpageurl",
  "existingpage",
  "existingpageid",
  "existingpageurl",
  "targetpage",
  "targetpageid",
]);

/**
 * True when a Notion plan says it changes a page that already exists. The
 * publisher only creates child pages, so such a plan must never be stored.
 */
export function claimsNotionPageUpdate(plan: {
  summary: string;
  items: { summary: string; fields: Record<string, string | number | null> }[];
}) {
  const wording = (value: string) =>
    updateWording.some((pattern) => pattern.test(value.toLowerCase()));
  // Body-like fields are page content, so only titles and page references count.
  const titleLike = new Set(["title", "name", "heading"]);
  return (
    wording(plan.summary) ||
    plan.items.some(
      (item) =>
        wording(item.summary) ||
        Object.entries(item.fields).some(([key, value]) => {
          const name = key.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (value === null || String(value).trim() === "") return false;
          if (pageReference.has(name)) return true;
          return titleLike.has(name) && wording(String(value));
        }),
    )
  );
}

/**
 * The refusal event for a Notion plan message that claims to change an
 * existing page, or null when the message may go on to the store.
 */
export function notionUpdateRefusalEvent(
  proposal:
    | {
        action: "propose-plan";
        destination?: unknown;
        summary: string;
        items?: { summary: string; fields: Record<string, unknown> }[];
      }
    | {
        action: "update-plan";
        items?: { summary: string; fields: Record<string, unknown> }[];
      }
    | { action: string },
  stored?: { destination: unknown; summary: string },
  /** True for a page Amun created itself and holds a receipt for. */
  ownPage: (pageId: string) => boolean = () => false,
) {
  if (proposal.action !== "propose-plan" && proposal.action !== "update-plan")
    return null;
  const p = proposal as {
    destination?: unknown;
    summary?: string;
    items?: { summary: string; fields: Record<string, unknown> }[];
  };
  const items = p.items ?? [];
  if (proposal.action === "update-plan" && !stored) return null;
  const destinations = [
    proposal.action === "propose-plan" ? p.destination : stored?.destination,
    ...items.map((i) => i.fields.destination),
  ];
  const toNotion = destinations.some(
    (value) =>
      typeof value === "string" && value.trim().toLowerCase() === "notion",
  );
  if (
    !toNotion ||
    !claimsNotionPageUpdate({
      summary:
        proposal.action === "propose-plan"
          ? (p.summary ?? "")
          : (stored?.summary ?? ""),
      items: items as {
        summary: string;
        fields: Record<string, string | number | null>;
      }[],
    })
  )
    return null;
  // An update of pages Amun created is reviewed and approved like any plan.
  if (
    items.length &&
    items.every((item) => {
      const page = notionPageOf(item.fields);
      return page !== undefined && ownPage(page);
    })
  )
    return null;
  return {
    version: 1 as const,
    kind: "work-result" as const,
    action: proposal.action,
    ok: false as const,
    message: notionUpdateRefusal,
    ref: null,
    step: null,
  };
}

export const localPlanRefusal =
  "That plan would go to an outside service, not stay local. Amun did not store it. Do not call it local; say plainly that this change cannot be made locally yet and nothing was changed.";
const localAsk =
  /\blocal(ly)?[\s-]only\b|\bkeep\s+(it|this|them|these)\s+local(ly)?\b|\blocal(ly)?\b(?=[^.]*\b(draft|sprint|plan|stories|story|change)\b)|\blocally\b|\bonly\s+in\s+amun\b/i;
const localClaim = /\blocal(ly)?\b|\bstays?\s+in\s+amun\b/i;
const external = new Set(["notion", "ado", "github"]);
const serviceNames: Record<string, string> = {
  notion: "notion",
  ado: "azure devops|azure\\s+boards|ado",
  github: "github",
};

// Forbids changing the plan's own destination; "do not publish" is not one.
function forbidsDestination(message: string, service: string) {
  return new RegExp(
    `\\b(do not|don't|dont|never)\\s+(change|touch|update|write to)\\s+(${serviceNames[service]})\\b`,
    "i",
  ).test(message);
}

function deniesDestination(summary: string, service: string) {
  return new RegExp(`\\bnot for\\s+(${serviceNames[service]})\\b`, "i").test(
    summary,
  );
}

/**
 * A plan for an outside destination must not be described as local, nor
 * stored when the owner's latest message asked for local-only work.
 */
export function localClaimRefusalEvent(
  proposal: {
    action: string;
    destination?: unknown;
    summary?: string;
    items?: { fields: Record<string, unknown> }[];
  },
  latestOwnerMessage: string,
) {
  if (proposal.action !== "propose-plan") return null;
  const places = [
    proposal.destination,
    ...(proposal.items ?? []).map((i) => i.fields.destination),
  ].map((v) => (typeof v === "string" ? v.trim().toLowerCase() : ""));
  const targets = places.filter((v) => external.has(v));
  if (!targets.length) return null;
  const summary = proposal.summary ?? "";
  if (
    !localAsk.test(latestOwnerMessage) &&
    !targets.some((t) => forbidsDestination(latestOwnerMessage, t)) &&
    !localClaim.test(summary) &&
    !targets.some((t) => deniesDestination(summary, t))
  )
    return null;
  return {
    version: 1 as const,
    kind: "work-result" as const,
    action: "propose-plan" as const,
    ok: false as const,
    message: localPlanRefusal,
    ref: null,
    step: null,
  };
}

const notionNames: Record<string, string> = {
  title: "title",
  body: "body",
  description: "body",
  append: "append",
  appendtext: "append",
  addline: "append",
  addlines: "append",
  parentpageid: "parent",
  parentid: "parent",
  parent: "parent",
  destination: "destination",
  page: "page",
  pageid: "page",
  pageurl: "page",
  pagelink: "page",
  notionpage: "page",
  notionpageid: "page",
  notionpageurl: "page",
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
  return {
    title,
    body: fields.body ?? title,
    page: fields.page,
    append: fields.append,
  };
}

/**
 * The exact title and content an update leaves on a page Amun created: new
 * values given in full, or lines appended to what Amun last wrote.
 */
export function notionUpdateText(
  receipt: { title: string; body: string },
  fields: Record<string, unknown>,
) {
  const get = (...names: string[]) => {
    for (const [key, value] of Object.entries(fields))
      if (
        names.includes(key.toLowerCase().replace(/[^a-z0-9]/g, "")) &&
        typeof value === "string" &&
        value.trim()
      )
        return value.trim();
  };
  const title = get("title") ?? receipt.title;
  if (!title) return undefined;
  const body = get("body", "description");
  const append = get("append", "appendtext", "addline", "addlines");
  if (append && body) return undefined;
  if (append) return { title, body: receipt.body + "\n" + append, append };
  return body ? { title, body } : undefined;
}

/** What the owner approved for one update, checked against Amun's receipts. */
export interface NotionPageReceipt {
  marker: string;
  version: string | null;
  url: string | null;
  /** What Amun last wrote, so lines can be appended to it. */
  title?: string;
  body?: string;
}
function updateOf(
  item: PlanWriteItem,
  destination: NotionDestination,
  receipts: ((pageId: string) => NotionPageReceipt | undefined) | undefined,
) {
  const named = notionPageOf(item.fields);
  const page = notionPage(item, destination);
  if (!page.page) return undefined;
  if (!named)
    throw new PlanNotSent("That is not a Notion page link. Nothing was sent.");
  const receipt = receipts?.(named);
  if (!receipt)
    throw new PlanNotSent(
      "Amun can only update a Notion page it created itself. Nothing was sent.",
    );
  if (!receipt.version)
    throw new PlanNotSent(
      "Amun did not record how this page looked when it wrote it, so it will not change it. Nothing was sent.",
    );
  const result = notionUpdateText(
    { title: receipt.title ?? "", body: receipt.body ?? "" },
    item.fields,
  );
  if (!result)
    throw new PlanNotSent(
      "An update needs the new content, or the lines to add, but not both. Nothing was sent.",
    );
  return { pageId: named, receipt, title: result.title, body: result.body };
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
    readPage?(
      pageId: string,
      workspaceId: string,
      titleProperty?: string,
    ): Promise<NotionPageSnapshot>;
    updatePage?(
      input: NotionPageUpdate,
      workspaceId: string,
      beforeSend: () => void,
    ): Promise<NotionUpdateOutcome>;
  },
  /** Amun's own receipt for a page it created; none for any other page. */
  receipts?: (pageId: string) => NotionPageReceipt | undefined,
): PlanTarget {
  const property =
    destination.parentType === "data_source_id" &&
    destination.markerPropertyAvailable === true;
  const receipt = (pageId: string) => ({
    externalId: pageId,
    url: "https://www.notion.so/" + pageId.replaceAll("-", ""),
  });
  const bare = (pageId: string) => pageId.replaceAll("-", "");
  // After a created page: what it looks like now, kept for the conflict check.
  const versionOf = async (pageId: string) => {
    try {
      return (
        await connection.readPage?.(
          pageId,
          workspaceId,
          destination.titleProperty,
        )
      )?.version;
    } catch {
      return undefined;
    }
  };
  const update = async (
    item: PlanWriteItem,
    change: NonNullable<ReturnType<typeof updateOf>>,
  ) => {
    if (!connection.updatePage)
      throw new PlanNotSent("Notion could not be reached. Nothing was sent.");
    let sent = false;
    let outcome: NotionUpdateOutcome;
    try {
      outcome = await connection.updatePage(
        {
          pageId: change.pageId,
          expectedVersion: change.receipt.version!,
          parentId: destination.parentId,
          titleProperty: destination.titleProperty,
          title: change.title,
          text: change.body,
          marker: change.receipt.marker,
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
    if (outcome.state === "refused") {
      console.error("notion update refused:", redactedError(outcome.detail));
      throw new PlanNotSent(refusalReason("notion", outcome.detail));
    }
    if (outcome.state === "changed")
      throw new PlanChanged(notionChangedNote, outcome.url);
    if (outcome.state === "elsewhere")
      throw new PlanNotSent(
        "That page is not under the connected Notion destination. Nothing was sent.",
      );
    if (outcome.state === "gone")
      throw new PlanNotSent(
        "That page was deleted in Notion. Nothing was sent.",
      );
    if (outcome.state !== "updated") {
      if (!sent) throw new PlanNotSent("Notion did not accept the update.");
      throw Error("Notion did not confirm the update.");
    }
    return {
      externalId: change.pageId,
      url: change.receipt.url ?? "https://www.notion.so/" + bare(change.pageId),
      updated: true,
      version: outcome.version,
    };
  };
  return {
    async write(item) {
      const change = updateOf(item, destination, receipts);
      if (change) return update(item, change);
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
      const version = await versionOf(result.pageId);
      return { ...receipt(result.pageId), ...(version ? { version } : {}) };
    },
    async find(item) {
      const change = updateOf(item, destination, receipts);
      if (change) {
        if (!connection.readPage)
          throw Error("Notion has not confirmed whether the page changed.");
        const now = await connection.readPage(
          change.pageId,
          workspaceId,
          destination.titleProperty,
        );
        // The page already holds the approved content, so it was updated.
        return now.content ===
          updatedContent(
            { text: change.body, marker: change.receipt.marker },
            now.content,
          ) && now.title === change.title
          ? {
              externalId: change.pageId,
              url: now.url,
              updated: true,
              version: now.version,
            }
          : undefined;
      }
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
