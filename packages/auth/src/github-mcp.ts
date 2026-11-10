import { verifyAmunManifest } from "./github-manifest.ts";
export class GithubReadFailure extends Error {}
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { boundedMcpResponse } from "./notion-response.ts";
export async function checkGithubMcp(token: string) {
  await useGithubClient(token, "repos", readManifest);
}
async function useGithubClient<T>(
  token: string,
  toolset: "repos" | "issues",
  use: (client: Client, stage: (name: string) => void) => Promise<T>,
) {
  const endpoint = "https://api.githubcopilot.com/mcp/";
  const { Client, StreamableHTTPClientTransport } =
    await import("./mcp-client.ts");
  const client = new Client({ name: "amun", version: "0.1.0" });
  let stage = "server initialization";
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: {
          headers: {
            Authorization: "Bearer " + token,
            "X-MCP-Toolsets": toolset,
            ...(toolset === "repos" ? { "X-MCP-Readonly": "true" } : {}),
          },
        },
        fetch: async (input, init) => {
          if (String(input) !== endpoint)
            throw Error("Unexpected GitHub endpoint");
          const response = boundedMcpResponse(
            await fetch(endpoint, {
              ...init,
              redirect: "error",
              signal: AbortSignal.any([
                AbortSignal.timeout(15000),
                ...(init?.signal ? [init.signal] : []),
              ]),
            }),
          );
          if (response.status === 403) {
            const challenge = response.headers.get("www-authenticate") ?? "";
            const reason = await response.text();
            const scope = challenge
              .match(/\bscope="([^"]{1,200})"/i)?.[1]
              ?.split(/ +/)
              .filter((s) =>
                [
                  "repo",
                  "public_repo",
                  "read:org",
                  "user:email",
                  "read:user",
                ].includes(s),
              );
            const kind =
              /insufficient_scope|missing.{0,40}scope|scope.{0,30}required/i.test(
                challenge + " " + reason,
              )
                ? "insufficient OAuth scope"
                : /saml|single sign.on/i.test(reason)
                  ? "organization SSO required"
                  : /rate.limit/i.test(reason)
                    ? "rate limit"
                    : /resource not accessible by integration/i.test(reason)
                      ? "credential access denied"
                      : /copilot.{0,60}(license|subscription|entitlement)/i.test(
                            reason,
                          )
                        ? "Copilot entitlement"
                        : "access denied";
            throw new GithubReadFailure(
              "GitHub repository check stopped during " +
                stage +
                " (403, " +
                kind +
                (scope?.length
                  ? ", requested scopes " + scope.join(", ")
                  : "") +
                ").",
            );
          }
          return response;
        },
      }),
    );
    return await use(client, (name) => {
      stage = name;
    });
  } catch (error) {
    if (error instanceof GithubReadFailure) throw error;
    const code =
      error &&
      typeof error === "object" &&
      "code" in error &&
      Number.isInteger(error.code)
        ? String(error.code)
        : "unavailable";
    throw new GithubReadFailure(
      "GitHub repository check stopped during " +
        stage +
        " (protocol status " +
        code +
        ").",
    );
  } finally {
    await client.close();
  }
}

async function readManifest(client: Client, stage: (s: string) => void) {
  const { CallToolResultSchema } = await import("./mcp-client.ts");
  stage("tool listing");
  const tools = await client.listTools();
  if (!tools.tools.some((t) => t.name === "get_file_contents"))
    throw Error("Repository tool unavailable");
  stage("get_file_contents on main");
  const result = await client.request(
    {
      method: "tools/call",
      params: {
        name: "get_file_contents",
        arguments: {
          owner: "tamer-sabry8",
          repo: "amun",
          path: "package.json",
          ref: "refs/heads/main",
        },
      },
    },
    CallToolResultSchema,
  );
  if (result.isError)
    throw new GithubReadFailure(
      "GitHub returned a tool error reading package.json.",
    );
  if (!verifyAmunManifest(result))
    throw new GithubReadFailure(
      "GitHub replied, but the Amun package manifest could not be verified.",
    );
}
export async function createGithubIssue(
  token: string,
  issue: { owner: string; repo: string; title: string; body: string },
) {
  return useGithubClient(token, "issues", async (client, stage) => {
    stage("issue tool discovery");
    const listed = await client.listTools();
    if (!listed.tools.some((tool) => tool.name === "issue_write"))
      throw Error("Issue creation unavailable");
    stage("issue creation");
    const r = await client.callTool({
      name: "issue_write",
      arguments: { method: "create", ...issue },
    });
    if (r.isError || !Array.isArray(r.content))
      throw Error("Issue creation unconfirmed");
    for (const item of r.content) {
      if (item.type !== "text" || typeof item.text !== "string") continue;
      const value = JSON.parse(item.text);
      if (typeof value.url !== "string") continue;
      const url = new URL(value.url);
      const prefix = "/" + issue.owner + "/" + issue.repo + "/issues/";
      if (
        url.origin === "https://github.com" &&
        url.pathname.startsWith(prefix) &&
        /^\d+$/.test(url.pathname.slice(prefix.length))
      )
        return Number(url.pathname.slice(prefix.length));
    }
    throw Error("Issue receipt missing");
  });
}
