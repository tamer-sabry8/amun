import { azureTransport } from "../../../packages/connectors-ado/src/transport.ts";
import type { PullAdapter } from "./pr-repositories.ts";
import type { PullDetail } from "../../../packages/contracts/src/pr-workspace.ts";
type Pr = {
  pullRequestId: number;
  title: string;
  description?: string;
  status: string;
  mergeStatus: string;
  isDraft?: boolean;
  lastMergeSourceCommit: { commitId: string };
  lastMergeTargetCommit: { commitId: string };
  targetRefName: string;
  sourceRefName: string;
  repository: { id: string; project: { id: string } };
  reviewers: { displayName: string; vote: number }[];
};
type Policy = {
  configuration: {
    isBlocking: boolean;
    isEnabled: boolean;
    type: { displayName: string };
  };
  status: string;
};
type Change = {
  item: { path: string; objectId?: string; originalObjectId?: string };
  originalPath?: string;
  changeType: string;
};
export function azurePulls(
  collection: string,
  project: string,
  repo: string,
  token: string,
): PullAdapter {
  const tx = azureTransport(collection, token),
    e = encodeURIComponent;
  const projectBase = e(project) + "/_apis/",
    git = projectBase + "git/repositories/" + e(repo),
    pr = (n: number) => git + "/pullrequests/" + n;
  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
    version = "7.0",
  ): Promise<T> {
    const response = await tx(
      method,
      collection +
        path +
        (path.includes("?") ? "&" : "?") +
        "api-version=" +
        version,
      body,
    );
    if (response.status < 200 || response.status >= 300)
      throw Error("Azure Repos request rejected (" + response.status + ").");
    return response.data as T;
  }
  const read = (n: number) => call<Pr>("GET", pr(n));
  const get = async <T>(path: string, version?: string) =>
    (await call<{ value: T[] }>("GET", path, undefined, version)).value;
  async function changes(n: number) {
    const its = await get<{ id: number }>(pr(n) + "/iterations");
    const last = Math.max(...its.map((i) => i.id));
    if (!Number.isSafeInteger(last)) return [];
    return (
      await call<{ changeEntries: Change[] }>(
        "GET",
        pr(n) + "/iterations/" + last + "/changes?$top=300&$compareTo=0",
      )
    ).changeEntries;
  }
  const identity = async () =>
    (
      await call<{ authenticatedUser: { id: string } }>(
        "GET",
        "_apis/connectionData",
      )
    ).authenticatedUser.id;
  async function permission(p: Pr) {
    const spaces = await get<{
      name: string;
      namespaceId: string;
      actions: { name: string; bit: number }[];
    }>("_apis/securitynamespaces");
    const ns = spaces.find((s) => s.name === "Git Repositories");
    if (!ns) return false;
    const bit = ns.actions.find((a) => a.name === "GenericContribute")?.bit;
    if (!bit) return false;
    const branch = p.targetRefName
      .replace(/^refs\/heads\//, "")
      .split("/")
      .map((s) => Buffer.from(s, "utf16le").toString("hex"))
      .join("/");
    const resource =
      "repoV2/" +
      p.repository.project.id +
      "/" +
      p.repository.id +
      "/refs/heads/" +
      branch;
    const result = await get<boolean>(
      "_apis/permissions/" +
        ns.namespaceId +
        "/" +
        bit +
        "?alwaysAllowAdministrators=false&tokens=" +
        e(resource),
    );
    return result.length === 1 && result[0] === true;
  }
  return {
    list: async () => {
      const rows: Pr[] = [];
      for (let skip = 0; ; skip += 100) {
        const page = await get<Pr>(
          git +
            "/pullrequests?searchCriteria.status=active&$top=100&$skip=" +
            skip,
        );
        rows.push(...page);
        if (page.length < 100) break;
        if (skip >= 9900)
          throw Error(
            "Repository pull request list exceeds the supported limit.",
          );
      }
      return rows.map((x) => ({
        number: x.pullRequestId,
        title: x.title,
        url:
          collection +
          e(project) +
          "/_git/" +
          e(repo) +
          "/pullrequest/" +
          x.pullRequestId,
      }));
    },
    details: async (n) => {
      const p = await read(n),
        artifact =
          "vstfs:///CodeReview/CodeReviewId/" +
          p.repository.project.id +
          "/" +
          n;
      const [policies, files, threads, permitted] = await Promise.all([
        get<Policy>(
          projectBase +
            "policy/evaluations?artifactId=" +
            e(artifact) +
            "&$top=1000",
          "7.0-preview.1",
        ),
        changes(n),
        get<{ status: string; comments: { content?: string }[] }>(
          pr(n) + "/threads",
        ),
        permission(p).catch(() => false),
      ]);
      const required = policies.filter(
        (x) => x.configuration.isEnabled && x.configuration.isBlocking,
      );
      return {
        head: p.lastMergeSourceCommit.commitId,
        base: p.targetRefName,
        sourceBranch: p.sourceRefName.replace(/^refs\/heads\//, ""),
        merged: p.status === "completed",
        permitted,
        ready:
          p.status === "active" &&
          !p.isDraft &&
          p.mergeStatus === "succeeded" &&
          policies.length < 1000 &&
          required.every((x) =>
            ["approved", "notApplicable"].includes(x.status),
          ),
        methods: ["merge", "squash", "rebase"],
        title: p.title,
        summary: (p.description ?? "").slice(0, 32768),
        files: files.map((f) => f.item.path),
        checks: policies.map(
          (x) => x.configuration.type.displayName + " · " + x.status,
        ),
        reviews: p.reviewers.map((r) => r.displayName + " · " + r.vote),
        threads: threads
          .filter((t) => t.status === "active" || t.status === "pending")
          .map((t) => t.comments[0]?.content?.slice(0, 2048) ?? "Open thread"),
        votes: p.status === "active" ? ["comment", "approve", "changes"] : [],
      } satisfies PullDetail;
    },
    diff: async (n, path, head) => {
      const p = await read(n);
      if (p.lastMergeSourceCommit.commitId !== head)
        throw Error("Refresh the changed PR head.");
      const f = (await changes(n)).find((c) => c.item.path === path);
      if (!f) throw Error("Select a changed file.");
      const item = async (name: string, ref: string) => {
        if (!/^[a-f0-9]{40}$/.test(ref)) throw Error("Invalid Git commit.");
        const query = new URLSearchParams({
          path: name,
          includeContent: "true",
          includeContentMetadata: "true",
          "versionDescriptor.versionType": "commit",
          "versionDescriptor.version": ref,
          $format: "json",
        });
        const r = await call<{
          content?: string;
          contentMetadata?: { isBinary?: boolean };
        }>("GET", git + "/items?" + query);
        if (
          typeof r.content !== "string" ||
          r.contentMetadata?.isBinary ||
          r.content.includes("\0") ||
          Buffer.byteLength(r.content) > 524288
        )
          throw Error("Text diff unavailable for this file.");
        return r.content;
      };
      const types = f.changeType.toLowerCase().split(/[, ]+/);
      const [before, after] = await Promise.all([
        types.includes("add")
          ? ""
          : item(f.originalPath ?? path, p.lastMergeTargetCommit.commitId),
        types.includes("delete") ? "" : item(path, head),
      ]);
      return { before, after };
    },
    review: async (n, head, vote, body) => {
      if ((await read(n)).lastMergeSourceCommit.commitId !== head)
        throw Error("Refresh the changed PR head.");
      const id = vote === "comment" ? null : await identity();
      await call("POST", pr(n) + "/threads", {
        comments: [{ parentCommentId: 0, content: body, commentType: 1 }],
        status: 1,
      });
      if (id) {
        await call("PUT", pr(n) + "/reviewers/" + e(id), {
          id,
          vote: vote === "approve" ? 10 : -5,
        });
      }
    },
    merge: async (n, head, method) => {
      await call("PATCH", pr(n), {
        status: "completed",
        lastMergeSourceCommit: { commitId: head },
        completionOptions: {
          mergeStrategy: method === "merge" ? "noFastForward" : method,
          bypassPolicy: false,
        },
      });
    },
  };
}
