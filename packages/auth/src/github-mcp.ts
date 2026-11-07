import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { boundedMcpResponse } from "./notion-response.ts";
export async function checkGithubMcp(token: string) {
  const endpoint = "https://api.githubcopilot.com/mcp/";
  const client = new Client({ name: "amun", version: "0.1.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: {
          headers: {
            Authorization: "Bearer " + token,
            "X-MCP-Toolsets": "repos",
            "X-MCP-Readonly": "true",
          },
        },
        fetch: async (input, init) => {
          if (String(input) !== endpoint)
            throw Error("Unexpected GitHub endpoint");
          return boundedMcpResponse(
            await fetch(endpoint, {
              ...init,
              redirect: "error",
              signal: AbortSignal.any([
                AbortSignal.timeout(15000),
                ...(init?.signal ? [init.signal] : []),
              ]),
            }),
          );
        },
      }),
    );
    const tools = await client.listTools();
    if (!tools.tools.some((t) => t.name === "get_file_contents"))
      throw Error("Repository tool unavailable");
    const result = await client.callTool({
      name: "get_file_contents",
      arguments: { owner: "tamer-sabry8", repo: "amun", path: "package.json" },
    });
    if (
      result.isError ||
      !result.content ||
      !Array.isArray(result.content) ||
      !result.content.length
    )
      throw Error("Repository read unverified");
  } finally {
    await client.close();
  }
}
