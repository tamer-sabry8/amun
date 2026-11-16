import type { PullDetail } from "../../../packages/contracts/src/pr-workspace.ts";
export function repositoryTarget(reference: string) {
  const u = new URL(reference);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    reference.includes("\\")
  )
    throw Error("Invalid repository URL");
  const path = u.pathname
    .replace(/\/$/, "")
    .slice(1)
    .split("/")
    .map(decodeURIComponent);
  if (
    path.some(
      (p) => !p || p === "." || p === ".." || /[\\/\u0000-\u001f]/.test(p),
    )
  )
    throw Error("Invalid repository path");
  const repo = path.at(-1)!.replace(/\.git$/, "");
  if (!repo) throw Error("Missing repository name");
  if (path.length >= 3 && path.at(-2) === "_git") {
    const project = path.at(-3)!;
    const prefix = path.slice(0, -3).map(encodeURIComponent).join("/");
    const collection = u.origin + "/" + (prefix ? prefix + "/" : "");
    return {
      provider: "Azure Repos" as const,
      project,
      collection,
      repo,
      url: u.href,
    };
  }
  if (path.length !== 2) throw Error("Map an HTTPS repository URL.");
  return {
    provider: "GitHub" as const,
    origin: u.origin,
    owner: path[0]!,
    repo,
    url: u.href,
  };
}
export type PullRow = {
  number: number;
  title: string;
  url: string;
  author?: string;
  draft?: boolean;
  checks?: "passing" | "failing" | "running" | "none";
  files?: number;
  additions?: number;
  deletions?: number;
};
const rollup: Record<string, PullRow["checks"]> = {
  SUCCESS: "passing",
  FAILURE: "failing",
  ERROR: "failing",
  PENDING: "running",
  EXPECTED: "running",
};
export type GithubNode = {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  author: { login: string } | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: {
    nodes: { commit: { statusCheckRollup: { state: string } | null } }[];
  };
};
/** One open pull request from GitHub's list query, trimmed to what the list shows. */
export function githubRow(node: GithubNode): PullRow {
  const state = node.commits.nodes[0]?.commit.statusCheckRollup?.state;
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    ...(node.author ? { author: node.author.login } : {}),
    draft: node.isDraft,
    checks: (state && rollup[state]) || "none",
    files: node.changedFiles,
    additions: node.additions,
    deletions: node.deletions,
  };
}
export interface PullAdapter {
  list(): Promise<PullRow[]>;
  details(number: number): Promise<PullDetail>;
  diff(
    number: number,
    path: string,
    head: string,
  ): Promise<{ before: string; after: string }>;
  review(
    number: number,
    head: string,
    vote: "comment" | "approve" | "changes",
    body: string,
  ): Promise<void>;
  merge(
    number: number,
    head: string,
    method: "squash" | "merge" | "rebase",
  ): Promise<void>;
}
