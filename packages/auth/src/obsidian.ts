import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { boundedMcpResponse } from "./notion-response.ts";
import { obsidianEndpoints } from "../../contracts/src/auth.ts";

export async function probeObsidian(
  endpoint: string,
  key: string,
  send: typeof fetch,
) {
  if (!obsidianEndpoints.some((url) => url === endpoint)) return false;
  const client = new Client({ name: "amun", version: "0.1.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint), {
        fetch: async (url, init = {}) => {
          if (String(url) !== endpoint)
            throw Error("Unexpected Obsidian endpoint");
          const headers = new Headers(init.headers);
          headers.set("Authorization", "Bearer " + key);
          return boundedMcpResponse(
            await send(endpoint, {
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
        },
      }),
    );
    const tools = await client.listTools();
    return tools.tools.some((tool) => tool.name === "vault_read");
  } catch {
    return false;
  } finally {
    await client.close();
  }
}
