import type { NotionSend } from "./client.ts";
/** One request only. The caller must persist intent before invocation and reconcile uncertain results. */
export function notionTransport(
  secret: string,
  request: typeof fetch = fetch,
): NotionSend {
  if (!secret || secret.length > 65536 || /[\r\n\0]/.test(secret))
    throw Error("Invalid Notion credential");
  return async (body) => {
    try {
      const response = await request("https://api.notion.com/v1/pages", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: "Bearer " + secret,
          "Content-Type": "application/json",
          "Notion-Version": "2026-03-11",
        },
        body: JSON.stringify(body),
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
