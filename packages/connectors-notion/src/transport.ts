import type { NotionSend } from "./client.ts";
import type { NotionGet } from "./target.ts";
/** One request only. The caller must persist intent before invocation and reconcile uncertain results. */
function notionRequest(secret: string, request: typeof fetch = fetch) {
  if (!secret || secret.length > 65536 || /[\r\n\0]/.test(secret))
    throw Error("Invalid Notion credential");
  return async (method: "GET" | "POST", path: string, body?: unknown) => {
    try {
      const response = await request("https://api.notion.com" + path, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: "Bearer " + secret,
          "Content-Type": "application/json",
          "Notion-Version": "2026-03-11",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.body) throw Error("Missing response");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1048576) throw Error("Response limit");
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      return {
        status: response.status,
        data: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
      };
    } catch {
      throw Error("Notion request outcome is unconfirmed");
    }
  };
}

export function notionTransport(
  secret: string,
  request: typeof fetch = fetch,
): NotionSend {
  const send = notionRequest(secret, request);
  return (body) => send("POST", "/v1/pages", body);
}
export function notionReadTransport(
  secret: string,
  request: typeof fetch = fetch,
): NotionGet {
  const send = notionRequest(secret, request);
  return async (path) => {
    if (
      !/^\/v1\/(?:pages|databases|data_sources)\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        path,
      )
    )
      throw Error("Invalid Notion metadata route");
    return send("GET", path);
  };
}
