/**
 * Azure DevOps Server 2022 checks over REST API 7.0 with a personal access
 * token (Basic auth, empty user). Read-only: it never creates or edits work.
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface AdoProject {
  id: string;
  name: string;
}

export type AdoProbeResult =
  | { ok: true; user: string | null; projects: AdoProject[] }
  | { ok: false; reason: AdoProbeFailure; message: string };

export type AdoProbeFailure = "unauthorized" | "forbidden" | "not_found" | "unreachable" | "rejected";

const API_VERSION = "7.0";

/** The collection URL with a trailing slash, from a collection or project URL. */
export function adoCollectionUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Use the https address of your Azure DevOps collection, without sign-in details");
  }
  return url.href.replace(/\/?$/, "/");
}

export function patIsWellFormed(pat: string): boolean {
  return pat.length >= 20 && pat.length <= 512 && /^[A-Za-z0-9]+$/.test(pat);
}

function authHeader(pat: string): string {
  return `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
}

const FAILURE_MESSAGES: Record<AdoProbeFailure, string> = {
  unauthorized: "Azure DevOps refused the token. Check that it is current and copied in full.",
  forbidden: "The token works but cannot read projects. Give it Project and Team (Read) and Work Items (Read & write).",
  not_found: "No Azure DevOps collection at that address. Paste the collection URL, for example https://devops.example.com/DefaultCollection/.",
  unreachable: "Amun could not reach that server. Check VPN and that this Mac trusts the server's certificate.",
  rejected: "Azure DevOps answered with an error.",
};

function failure(reason: AdoProbeFailure, detail?: string): AdoProbeResult {
  return {
    ok: false,
    reason,
    message: detail ? `${FAILURE_MESSAGES[reason]} (${detail})` : FAILURE_MESSAGES[reason],
  };
}

export async function probeAdo(input: {
  collectionUrl: string;
  pat: string;
  fetch?: FetchLike;
}): Promise<AdoProbeResult> {
  const base = adoCollectionUrl(input.collectionUrl);
  const doFetch = input.fetch ?? ((url, init) => fetch(url, init));
  const headers = { Authorization: authHeader(input.pat), Accept: "application/json" };
  async function get(path: string): Promise<Response | AdoProbeResult> {
    try {
      return await doFetch(`${base}${path}${path.includes("?") ? "&" : "?"}api-version=${API_VERSION}`, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return failure("unreachable");
    }
  }
  const projects = await get("_apis/projects?$top=200");
  if (!(projects instanceof Response)) return projects;
  // Azure answers a bad token with 401, or 203 / a redirect to its sign-in page.
  if (projects.status === 401 || projects.status === 203 || (projects.status >= 300 && projects.status < 400)) {
    return failure("unauthorized");
  }
  if (projects.status === 403) return failure("forbidden");
  if (projects.status === 404) return failure("not_found");
  if (!projects.ok) return failure("rejected", `HTTP ${projects.status}`);
  let body: unknown;
  try {
    body = await projects.json();
  } catch {
    return failure("unauthorized");
  }
  const value = (body as { value?: unknown }).value;
  if (!Array.isArray(value)) return failure("rejected", "unexpected answer");
  const list: AdoProject[] = value
    .filter(
      (p): p is { id: string; name: string } =>
        typeof p === "object" && p !== null && typeof p.id === "string" && typeof p.name === "string",
    )
    .map((p) => ({ id: p.id, name: p.name }));

  let user: string | null = null;
  const connection = await get("_apis/connectionData");
  if (connection instanceof Response && connection.ok) {
    const data = (await connection.json().catch(() => null)) as {
      authenticatedUser?: { providerDisplayName?: unknown };
    } | null;
    const name = data?.authenticatedUser?.providerDisplayName;
    if (typeof name === "string") user = name;
  }
  return { ok: true, user, projects: list };
}
