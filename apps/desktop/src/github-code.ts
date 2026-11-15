import { Octokit } from "@octokit/rest";

export interface RepoAccess {
  defaultBranch: string;
  private: boolean;
  canPush: boolean;
  /** Classic token scopes; null when GitHub does not report any. */
  scopes: string[] | null;
}
export interface CodeHost {
  viewer(): Promise<{ login: string; name: string; email: string }>;
  access(): Promise<RepoAccess>;
  findPull(
    branch: string,
  ): Promise<{ number: number; url: string } | undefined>;
  createPull(input: {
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<{ number: number; url: string }>;
}

/** Whether this sign-in may write to the repository, judged by what GitHub reports. */
export function canWrite(access: RepoAccess) {
  if (!access.canPush) return false;
  if (access.scopes === null) return true;
  return access.private
    ? access.scopes.includes("repo")
    : access.scopes.includes("repo") || access.scopes.includes("public_repo");
}
export const cannotWrite = (repo: string) =>
  `Amun's GitHub sign-in can't write to ${repo}. Reconnect GitHub with access to private repositories in Settings › Tools.`;

export function githubCode(
  origin: string,
  owner: string,
  repo: string,
  token: string,
): CodeHost {
  const api = new Octokit({
    auth: token,
    baseUrl:
      origin === "https://github.com"
        ? "https://api.github.com"
        : origin + "/api/v3",
    request: { redirect: "error", timeout: 20000 },
  });
  const where = { owner, repo };
  return {
    async viewer() {
      const { data } = await api.rest.users.getAuthenticated();
      return {
        login: data.login,
        name: data.name || data.login,
        email:
          data.email || `${data.id}+${data.login}@users.noreply.github.com`,
      };
    },
    async access() {
      const [r, me] = await Promise.all([
        api.rest.repos.get(where),
        api.rest.users.getAuthenticated(),
      ]);
      const header = me.headers["x-oauth-scopes"];
      return {
        defaultBranch: r.data.default_branch,
        private: r.data.private,
        canPush: r.data.permissions?.push === true,
        scopes:
          typeof header === "string"
            ? header
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : null,
      };
    },
    async findPull(branch) {
      const { data } = await api.rest.pulls.list({
        ...where,
        head: `${owner}:${branch}`,
        state: "all",
        per_page: 5,
      });
      const found = data[0];
      return found ? { number: found.number, url: found.html_url } : undefined;
    },
    async createPull(input) {
      const { data } = await api.rest.pulls.create({
        ...where,
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
      });
      return { number: data.number, url: data.html_url };
    },
  };
}
