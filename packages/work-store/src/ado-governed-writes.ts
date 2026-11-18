import type { Transport } from "./ado-client.ts";
import { azurePathSegment } from "./ado-path.ts";
import type { AdoStep, AdoReceipt } from "./ado-batch.ts";
/** Azure's rejection of a create because the work item type is not in the project. */
export class AdoTypeMissing extends Error {}
const missingTypeText =
  /TF26199|VS402\d+|work item type\b[^.]*\b(does not exist|not found)\b|is not a work item type|WorkItemType(NotFound|DoesNotExist)/i;
/** True for Azure's wording when a work item type is not in the project. */
export const isMissingTypeText = (text: string) => missingTypeText.test(text);
/** Azure's own refusal text, with links and secrets removed and trimmed. */
export function redactAdoMessage(text: unknown) {
  return String(text ?? "")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/(bearer|basic|token|pat|password)[\s:=]+\S+/gi, "$1 [removed]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}
/** A non-2xx Azure answer. The message stays the short status code. */
export class AdoRejected extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super("request_rejected_" + status);
  }
}
const rejectionDetail = (data: unknown) => {
  const body = data && typeof data === "object" ? (data as object) : {};
  const pick = (key: string) => {
    const value = (body as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
  };
  const message = redactAdoMessage(pick("message"));
  const code = redactAdoMessage(pick("typeKey") || pick("errorCode"));
  return code && !message.includes(code)
    ? message
      ? `${message} (${code})`
      : code
    : message;
};
/** Both a trailing slash and none give exactly one slash before _apis. */
export const workItemUrl = (collection: string, id: number) =>
  collection.replace(/\/*$/, "/") + "_apis/wit/workItems/" + id;
const typeMissing = (status: number, data: unknown) => {
  if (status !== 400 && status !== 404) return false;
  const body = data && typeof data === "object" ? (data as object) : {};
  return ["typeKey", "message"].some(
    (key) => key in body && isMissingTypeText(String((body as never)[key])),
  );
};
/** Azure reports a person as an object; the plan may name them either way. */
export function sameAdoField(key: string, actual: unknown, expected: unknown) {
  if (key === "System.AssignedTo" && actual && typeof actual === "object") {
    const who = actual as { uniqueName?: unknown; displayName?: unknown };
    const want = String(expected).trim().toLowerCase();
    const names = [
      who.uniqueName,
      who.displayName,
      typeof who.displayName === "string" && typeof who.uniqueName === "string"
        ? `${who.displayName} <${who.uniqueName}>`
        : undefined,
    ];
    return names.some(
      (name) => typeof name === "string" && name.toLowerCase() === want,
    );
  }
  return actual === expected;
}
const decoded = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
const sameProject = (actual: string, expected: string) =>
  decoded(actual).trim().toLowerCase() ===
  decoded(expected).trim().toLowerCase();
type Item = AdoReceipt & {
  url?: string;
  fields: Record<string, unknown>;
  relations?: { rel: string; url: string }[];
};
export class AdoWriteClient {
  private prefix: string;
  constructor(
    private collection: string,
    private project: string,
    private transport: Transport,
  ) {
    this.prefix = new URL(
      azurePathSegment(project) + "/_apis/wit/",
      collection,
    ).href;
  }
  private async call(method: string, route: string, body?: unknown) {
    const url =
      this.prefix +
      route +
      (route.includes("?") ? "&" : "?") +
      "api-version=7.0";
    const r = await this.transport(method, url, body);
    if (r.status < 200 || r.status >= 300) {
      if (
        method === "POST" &&
        route.startsWith("workitems/$") &&
        typeMissing(r.status, r.data)
      )
        throw Object.assign(
          new AdoTypeMissing("request_rejected_" + r.status),
          {
            detail: rejectionDetail(r.data),
          },
        );
      if (r.status === 412) throw Error("revision_conflict");
      throw new AdoRejected(r.status, rejectionDetail(r.data));
    }
    return r.data;
  }
  async item(id: number) {
    if (!Number.isSafeInteger(id) || id < 1)
      throw Error("Invalid Azure item ID");
    const r = (await this.call(
      "GET",
      "workitems/" + id + "?$expand=Relations",
    )) as Item;
    if (
      r?.id !== id ||
      !Number.isSafeInteger(r.rev) ||
      !r.fields ||
      (r.fields["System.TeamProject"] &&
        !sameProject(String(r.fields["System.TeamProject"]), this.project))
    )
      throw Error("Azure item identity mismatch");
    return r;
  }
  async verify(id: number, step: AdoStep, parent: number | null) {
    const item = await this.item(id);
    if (item.fields["System.WorkItemType"] !== step.type)
      throw Error("Azure type changed");
    for (const [k, v] of Object.entries(step.fields)) {
      const actual = item.fields[k];
      if (sameAdoField(k, actual, v)) continue;
      const value = actual;
      if (
        (k === "System.Description" ||
          k === "Microsoft.VSTS.Common.AcceptanceCriteria") &&
        typeof value === "string" &&
        typeof v === "string"
      ) {
        // Azure inserts spaces before closing block tags in generated rich text.
        const closingBlock = / +(?=<\/(?:p|li|ul)>)/g;
        if (value.replace(closingBlock, "") === v.replace(closingBlock, ""))
          continue;
      }
      throw Error("Azure field verification failed");
    }
    if (!step.remoteId) {
      const tags = String(item.fields["System.Tags"] ?? "")
        .split(";")
        .map((t) => t.trim());
      if (
        !tags.includes(step.marker) ||
        (parent &&
          !item.relations?.some(
            (r) =>
              r.rel === "System.LinkTypes.Hierarchy-Reverse" &&
              r.url.toLowerCase().endsWith("/workitems/" + parent),
          ))
      )
        throw Error("Azure marker or parent mismatch");
    } else if (item.rev <= step.revision)
      throw Error("Azure revision did not advance");
    return { id: item.id, rev: item.rev };
  }
  /** The server's own URL for the parent, else one built from the collection. */
  private async parentUrl(parent: number) {
    try {
      const own = ((await this.call("GET", "workitems/" + parent)) as Item)
        ?.url;
      if (
        typeof own === "string" &&
        new URL(own).origin === new URL(this.collection).origin &&
        new RegExp("/workitems/" + parent + "$", "i").test(own)
      )
        return own;
    } catch {
      // Fall back to the collection address below.
    }
    return workItemUrl(this.collection, parent);
  }
  async write(step: AdoStep, parent: number | null) {
    const patch: { op: string; path: string; value: unknown }[] = [];
    if (step.remoteId)
      patch.push({ op: "test", path: "/rev", value: step.revision });
    for (const [key, value] of Object.entries(step.fields)) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,255}$/.test(key) || key === "System.Tags")
        throw Error("Invalid work item field");
      patch.push({ op: "add", path: "/fields/" + key, value });
    }
    if (!step.remoteId) {
      patch.push({
        op: "add",
        path: "/fields/System.Tags",
        value: step.marker,
      });
      if (parent)
        patch.push({
          op: "add",
          path: "/relations/-",
          value: {
            rel: "System.LinkTypes.Hierarchy-Reverse",
            url: await this.parentUrl(parent),
          },
        });
    }
    const result = (await this.call(
      step.remoteId ? "PATCH" : "POST",
      step.remoteId
        ? "workitems/" + step.remoteId
        : "workitems/$" + azurePathSegment(step.type),
      patch,
    )) as AdoReceipt;
    if (!result?.id || (step.remoteId && result.id !== step.remoteId))
      throw Error("Unconfirmed Azure receipt");
    return this.verify(result.id, step, parent);
  }
  async find(step: AdoStep, parent: number | null) {
    if (step.remoteId) return this.verify(step.remoteId, step, parent);
    if (!/^[A-Za-z0-9-]{1,128}$/.test(step.marker))
      throw Error("Invalid marker");
    const result = (await this.call("POST", "wiql", {
      query:
        "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Tags] CONTAINS '" +
        step.marker +
        "'",
    })) as { workItems: { id: number }[] };
    if (result?.workItems?.length !== 1) return undefined;
    return this.verify(result.workItems[0]!.id, step, parent);
  }
  /**
   * Read-only: the lowest-numbered item in this project with this exact title,
   * type and parent that Amun created (it carries an Amun marker tag).
   */
  async existing(
    title: string,
    type: string | string[],
    parent: number | null = null,
  ) {
    const types = Array.isArray(type) ? type : [type];
    const quote = (value: string) => value.replaceAll("'", "''");
    const search = (names: string[]) =>
      this.call("POST", "wiql", {
        query:
          "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Title] = '" +
          quote(title) +
          "' AND [System.WorkItemType] IN (" +
          names.map((name) => "'" + quote(name) + "'").join(",") +
          ") ORDER BY [System.Id]",
      }) as Promise<{ workItems?: { id: number }[] }>;
    let result: { workItems?: { id: number }[] };
    try {
      result = await search(types);
    } catch (error) {
      // Azure DevOps Server rejects the whole query when one listed type is not
      // in the project, so each type is asked alone and an unknown one has none.
      if (
        types.length < 2 ||
        !(error instanceof Error) ||
        error.message !== "request_rejected_400"
      )
        throw error;
      const workItems: { id: number }[] = [];
      for (const name of types) {
        try {
          workItems.push(...((await search([name]))?.workItems ?? []));
        } catch (single) {
          if (
            !(single instanceof Error) ||
            single.message !== "request_rejected_400"
          )
            throw single;
        }
      }
      result = { workItems: workItems.sort((a, b) => a.id - b.id) };
    }
    // A tag query cannot match by prefix, so the marker is checked on each.
    for (const { id } of (result?.workItems ?? []).slice(0, 20)) {
      const item = await this.item(id);
      const tags = String(item.fields["System.Tags"] ?? "")
        .split(";")
        .map((t) => t.trim());
      const above = item.relations
        ?.filter((r) => r.rel === "System.LinkTypes.Hierarchy-Reverse")
        .map((r) => Number(/\/workitems\/(\d+)$/i.exec(r.url)?.[1]));
      const sameParent = parent
        ? above?.includes(parent)
        : !above || above.length === 0;
      if (sameParent && tags.some((t) => t.startsWith("Amun-")))
        return { id: item.id };
    }
    return undefined;
  }
}
