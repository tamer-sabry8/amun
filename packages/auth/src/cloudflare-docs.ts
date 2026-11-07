import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { boundedMcpResponse } from "./notion-response.ts";
const endpoint = "https://docs.mcp.cloudflare.com/mcp";
export async function docsFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  const url = input instanceof Request ? input.url : String(input);
  const headers = new Headers(init.headers);
  if (
    url !== endpoint ||
    input instanceof Request ||
    ["authorization", "cookie", "proxy-authorization"].some((key) =>
      headers.has(key),
    )
  )
    throw Error("Unsafe docs request");
  return boundedMcpResponse(
    await fetch(url, {
      ...init,
      headers,
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.any([
        AbortSignal.timeout(8000),
        ...(init.signal ? [init.signal] : []),
      ]),
    }),
  );
}
export async function discoverCloudflareDocs(): Promise<string> {
  const c = new Client({ name: "amun", version: "0.1.0" });
  try {
    await c.connect(
      new StreamableHTTPClientTransport(new URL(endpoint), {
        fetch: docsFetch,
      }),
    );
    const result = await c.listTools();
    if (!result.tools.some((t) => t.name === "search_cloudflare_documentation"))
      throw Error("Documentation search unavailable");
    return "Cloudflare documentation search is available. Verified anonymously; no Cloudflare account access.";
  } finally {
    await c.close();
  }
}
