export type Transport = (
  method: string,
  url: string,
  body?: unknown,
) => Promise<{ status: number; data: unknown; continuationToken?: string }>;
export type ProofItem = { id: number; rev: number };
function positive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
export class AdoProofClient {
  private base: string;
  private project: string;
  private transport: Transport;
  constructor(base: string, project: string, transport: Transport) {
    const url = new URL(base);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !project ||
      project.length > 128 ||
      /[\/\\\x00-\x1f]/.test(project) ||
      project === ".." ||
      project === "."
    )
      throw new Error("Invalid Azure scope");
    this.base = url.href.replace(/\/?$/, "/");
    this.project = encodeURIComponent(project);
    this.transport = transport;
  }
  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    let response;
    try {
      response = await this.transport(
        method,
        this.base + path + (path.includes("?") ? "&" : "?") + "api-version=7.0",
        body,
      );
    } catch {
      throw new Error(
        method === "GET" ? "read_failed" : "write_outcome_unknown",
      );
    }
    if (response.status === 409 || response.status === 412)
      throw new Error("revision_conflict");
    if (response.status < 200 || response.status >= 300)
      throw new Error(
        response.status >= 500 && method !== "GET"
          ? "write_outcome_unknown"
          : `request_rejected_${response.status}`,
      );
    return response.data;
  }
  async read(name: string): Promise<unknown> {
    const p = this.project;
    const paths: Record<string, string> = {
      projects: "_apis/projects",
      project: `_apis/projects/${p}?includeCapabilities=true`,
      teams: `_apis/projects/${p}/teams`,
      processes: "_apis/process/processes",
      types: `${p}/_apis/wit/workitemtypes`,
      iterations: `${p}/_apis/wit/classificationnodes/iterations?$depth=2`,
      pullRequests: `${p}/_apis/git/pullrequests?searchCriteria.status=all&$top=10`,
    };
    const path = Object.hasOwn(paths, name) ? paths[name] : undefined;
    if (!path) throw new Error("Unsupported proof endpoint");
    return this.request("GET", path);
  }
  async item(id: number): Promise<unknown> {
    if (!positive(id)) throw new Error("Invalid item");
    return this.request("GET", `${this.project}/_apis/wit/workitems/${id}`);
  }
  private itemResult(data: unknown): ProofItem {
    if (
      !data ||
      typeof data !== "object" ||
      !("id" in data) ||
      !("rev" in data) ||
      typeof data.id !== "number" ||
      typeof data.rev !== "number" ||
      !positive(data.id) ||
      !positive(data.rev)
    )
      throw new Error("write_outcome_unknown");
    return { id: data.id, rev: data.rev };
  }
  async create(
    type: string,
    title: string,
    parent?: number,
  ): Promise<ProofItem> {
    const names: Record<string, string> = {
      "Product Backlog Item": "Test PBI",
      "User Story": "Test Story",
      Task: "Test Task",
    };
    if (
      !Object.hasOwn(names, type) ||
      names[type] !== title ||
      (parent !== undefined && !positive(parent))
    )
      throw new Error("Invalid proof item");
    const patch: unknown[] = [
      { op: "add", path: "/fields/System.Title", value: title },
    ];
    if (type === "Task")
      patch.push(
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
      );
    if (parent !== undefined)
      patch.push({
        op: "add",
        path: "/relations/-",
        value: {
          rel: "System.LinkTypes.Hierarchy-Reverse",
          url: this.base + "_apis/wit/workItems/" + parent,
        },
      });
    return this.itemResult(
      await this.request(
        "POST",
        `${this.project}/_apis/wit/workitems/$${encodeURIComponent(type)}`,
        patch,
      ),
    );
  }
  async update(id: number, rev: number): Promise<ProofItem> {
    if (!positive(id) || !positive(rev)) throw new Error("Invalid revision");
    return this.itemResult(
      await this.request("PATCH", `${this.project}/_apis/wit/workitems/${id}`, [
        { op: "test", path: "/rev", value: rev },
        {
          op: "add",
          path: "/fields/System.Description",
          value: "Test revision precondition verified.",
        },
      ]),
    );
  }
}
