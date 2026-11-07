import { cloudflareDestination } from "../../contracts/src/hosting.ts";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import {
  CF_ISSUER,
  NotionOAuthProvider,
  notionAuthFetch,
  readNotionOAuthRecord,
} from "./notion-oauth.ts";
import { createOAuthLoopback } from "./oauth-loopback.ts";
import { boundedMcpResponse } from "./notion-response.ts";
const endpoint = CF_ISSUER + "/mcp";
export function cloudflareConsentArgs(input: string) {
  const url = new URL(input);
  if (
    url.origin !== CF_ISSUER ||
    url.pathname !== "/authorize" ||
    url.username ||
    url.password ||
    url.hash
  )
    throw Error("Unexpected Cloudflare consent page");
  return ["-a", "Microsoft Edge", url.href];
}
export function cloudflareZoneCode(zone: string, host: string) {
  ({ zone, host } = cloudflareDestination.parse({
    provider: "cloudflare",
    zone,
    host,
  }));
  return `async () => {
 const zones=await cloudflare.request({method:"GET",path:${JSON.stringify("/zones?name=" + zone)}});
 const zone=zones.result?.find(z=>z.name===${JSON.stringify(zone)});
 if(!zone||!zone.id)throw Error("Zone unavailable");
 const records=await cloudflare.request({method:"GET",path:"/zones/"+zone.id+${JSON.stringify("/dns_records?name=" + host)}});
 if(!Array.isArray(records.result))throw Error("DNS inspection failed");
 return {zone:zone.name,host:${JSON.stringify(host)},records:records.result.filter(r=>r.name===${JSON.stringify(host)}).length};
}`;
}
export interface CloudflareOAuthOptions {
  read: () => string | undefined;
  write: (v: string) => void;
  open: (url: string) => Promise<void>;
  registerSecret: (v: string) => void;
}
export async function withCloudflareClient<T>(
  options: CloudflareOAuthOptions,
  scope: string,
  use: (client: Client) => Promise<T>,
) {
  const stored = readNotionOAuthRecord(options.read(), CF_ISSUER);
  let token = stored?.tokens?.access_token;
  if (!token || !stored?.expiresAt || stored.expiresAt <= Date.now() + 60000) {
    const listener = await createOAuthLoopback({
      issuer: CF_ISSUER,
      ...(stored ? { port: Number(new URL(stored.redirectUrl).port) } : {}),
    });
    const provider = new NotionOAuthProvider({
      ...options,
      issuer: CF_ISSUER,
      redirectUrl: listener.url,
      state: listener.state,
    });
    try {
      const config = {
        serverUrl: endpoint,
        scope,
        fetchFn: notionAuthFetch(fetch, CF_ISSUER),
      };
      if ((await auth(provider, config)) === "REDIRECT")
        await auth(provider, {
          ...config,
          authorizationCode: await listener.code,
        });
      token = provider.tokens()?.access_token;
    } finally {
      provider.dispose();
      listener.close();
    }
  }
  if (!token) throw Error("Cloudflare authorization incomplete");
  const client = new Client({ name: "amun", version: "0.1.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: { headers: { Authorization: "Bearer " + token } },
        fetch: async (input, init) => {
          if (String(input) !== endpoint)
            throw Error("Unexpected MCP endpoint");
          return boundedMcpResponse(
            await fetch(endpoint, {
              ...init,
              redirect: "error",
              signal: AbortSignal.timeout(20000),
            }),
          );
        },
      }),
    );
    const tools = await client.listTools();
    if (
      !["search", "execute"].every((name) =>
        tools.tools.some((t) => t.name === name),
      )
    )
      throw Error("Code Mode unavailable");
    return await use(client);
  } finally {
    await client.close();
  }
}
export async function inspectCloudflareHosting(
  options: CloudflareOAuthOptions,
  zone: string,
  host: string,
) {
  return withCloudflareClient(
    options,
    "user:read account:read zone.read dns.read",
    async (client) => {
      const search = await client.callTool({
        name: "search",
        arguments: {
          code: 'async () => Object.keys(spec.paths).filter(p => p === "/zones" || p === "/zones/{zone_id}/dns_records")',
        },
      });
      if (search.isError || !JSON.stringify(search.content).includes("/zones"))
        throw Error("Zone API discovery failed");
      const result = await client.callTool({
        name: "execute",
        arguments: { code: cloudflareZoneCode(zone, host) },
      });
      if (result.isError) throw Error("Cloudflare zone read failed");
      const item = z
        .object({
          content: z
            .array(
              z.object({ type: z.literal("text"), text: z.string().max(2048) }),
            )
            .length(1),
        })
        .parse(result);
      return z
        .object({
          zone: z.literal(zone),
          host: z.literal(host),
          records: z.number().int().nonnegative(),
        })
        .parse(JSON.parse(item.content[0]!.text)).records;
    },
  );
}
