import { boundedMcpResponse } from "./notion-response.ts";
export async function publicMcpFetch(
  endpoint: string,
  send: typeof fetch,
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
    throw Error("Unsafe public MCP request");
  return boundedMcpResponse(
    await send(url, {
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
