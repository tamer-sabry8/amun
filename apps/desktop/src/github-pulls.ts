import { Octokit } from "@octokit/rest";
import type { PullAdapter } from "./pr-repositories.ts";
import type { PullDetail } from "../../../packages/contracts/src/pr-workspace.ts";
type Graph = {
  repository: {
    viewerPermission: string;
    mergeCommitAllowed: boolean;
    squashMergeAllowed: boolean;
    rebaseMergeAllowed: boolean;
    pullRequest: {
      mergeStateStatus: string;
      headRefOid: string;
      isDraft: boolean;
      reviewThreads: {
        nodes: {
          isResolved: boolean;
          comments: { nodes: { body: string }[] };
        }[];
      };
      commits: {
        nodes: { commit: { statusCheckRollup: { state: string } | null } }[];
      };
    };
  };
};
export function githubPulls(
  origin: string,
  owner: string,
  repo: string,
  token: string,
): PullAdapter {
  const baseUrl =
    origin === "https://github.com"
      ? "https://api.github.com"
      : origin + "/api/v3";
  const api = new Octokit({
      auth: token,
      baseUrl,
      request: { redirect: "error", timeout: 20000 },
    }),
    where = { owner, repo };
  const pull = async (n: number) =>
    (await api.rest.pulls.get({ ...where, pull_number: n })).data;
  const files = async (n: number) =>
    api.paginate(api.rest.pulls.listFiles, {
      ...where,
      pull_number: n,
      per_page: 100,
    });
  const contents = async (path: string, ref: string) => {
    const result = await api.rest.repos.getContent({ ...where, path, ref });
    if (
      Array.isArray(result.data) ||
      !("content" in result.data) ||
      result.data.size > 524288 ||
      result.data.encoding !== "base64"
    )
      throw Error("Text diff unavailable for this file.");
    const b = Buffer.from(result.data.content, "base64");
    if (b.includes(0)) throw Error("Binary file.");
    return b.toString("utf8");
  };
  return {
    list: async () =>
      (
        await api.paginate(api.rest.pulls.list, {
          ...where,
          state: "open",
          per_page: 100,
        })
      ).map((x) => ({ number: x.number, title: x.title, url: x.html_url })),
    details: async (n) => {
      const [p, g, changed, reviews, user] = await Promise.all([
        pull(n),
        api.graphql<Graph>(
          `query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){viewerPermission mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed pullRequest(number:$number){headRefOid mergeStateStatus isDraft reviewThreads(first:100){nodes{isResolved comments(first:1){nodes{body}}}} commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}`,
          { ...where, number: n },
        ),
        files(n),
        api.paginate(api.rest.pulls.listReviews, {
          ...where,
          pull_number: n,
          per_page: 100,
        }),
        api.rest.users.getAuthenticated(),
      ]);
      const checks = await api.paginate(api.rest.checks.listForRef, {
        ...where,
        ref: p.head.sha,
        per_page: 100,
      });
      const r = g.repository,
        q = r.pullRequest;
      if (p.head.sha !== q.headRefOid)
        throw Error("Pull request changed during read.");
      const state =
        q.commits.nodes[0]?.commit.statusCheckRollup?.state ?? "NONE";
      const methods: PullDetail["methods"] = [];
      if (r.mergeCommitAllowed) methods.push("merge");
      if (r.squashMergeAllowed) methods.push("squash");
      if (r.rebaseMergeAllowed) methods.push("rebase");
      return {
        title: p.title,
        summary: (p.body ?? "").slice(0, 32768),
        head: p.head.sha,
        base: p.base.ref,
        sourceBranch: p.head.ref,
        merged: p.merged,
        permitted: ["ADMIN", "MAINTAIN", "WRITE"].includes(r.viewerPermission),
        ready:
          !q.isDraft &&
          q.mergeStateStatus === "CLEAN" &&
          ["SUCCESS", "NONE"].includes(state),
        methods,
        files: changed.slice(0, 300).map((x) => x.filename),
        checks: [
          q.mergeStateStatus,
          state,
          ...checks.map((c) => c.name + " · " + (c.conclusion ?? c.status)),
        ],
        reviews: reviews.map(
          (x) => (x.user?.login ?? "Reviewer") + " · " + x.state,
        ),
        threads: q.reviewThreads.nodes
          .filter((t) => !t.isResolved)
          .map((t) =>
            (t.comments.nodes[0]?.body ?? "Unresolved thread").slice(0, 2048),
          ),
        votes:
          p.state === "open"
            ? user.data.login === p.user?.login
              ? ["comment"]
              : ["comment", "approve", "changes"]
            : [],
      };
    },
    diff: async (n, path, head) => {
      const p = await pull(n);
      if (head !== p.head.sha) throw Error("Refresh the changed PR head.");
      const f = (await files(n)).find((f) => f.filename === path);
      if (!f) throw Error("Select a changed file.");
      const [before, after] = await Promise.all([
        f.status === "added"
          ? Promise.resolve("")
          : contents(f.previous_filename ?? path, p.base.sha),
        f.status === "removed" ? Promise.resolve("") : contents(path, head),
      ]);
      return { before, after };
    },
    review: async (n, head, vote, body) => {
      if ((await pull(n)).head.sha !== head)
        throw Error("Refresh the changed PR head.");
      await api.rest.pulls.createReview({
        ...where,
        pull_number: n,
        commit_id: head,
        event:
          vote === "approve"
            ? "APPROVE"
            : vote === "changes"
              ? "REQUEST_CHANGES"
              : "COMMENT",
        body,
      });
    },
    merge: async (n, head, method) => {
      const r = await api.rest.pulls.merge({
        ...where,
        pull_number: n,
        sha: head,
        merge_method: method,
      });
      if (!r.data.merged) throw Error("GitHub did not confirm the merge.");
    },
  };
}
