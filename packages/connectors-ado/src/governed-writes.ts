import type { Transport } from "./client.ts";
import { azurePathSegment } from "./path.ts";
import type { AdoStep, AdoReceipt } from "../../data/src/ado-batch.ts";
type Item = AdoReceipt & {
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
    if (r.status < 200 || r.status >= 300)
      throw Error(
        r.status === 412 ? "revision_conflict" : "request_rejected_" + r.status,
      );
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
        r.fields["System.TeamProject"] !== this.project)
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
      const value =
        k === "System.AssignedTo" &&
        actual &&
        typeof actual === "object" &&
        "uniqueName" in actual
          ? actual.uniqueName
          : actual;
      if (value === v) continue;
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
            url: this.collection + "_apis/wit/workItems/" + parent,
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
}
