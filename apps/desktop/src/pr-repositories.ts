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
export interface PullAdapter {
  list(): Promise<{ number: number; title: string; url: string }[]>;
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
