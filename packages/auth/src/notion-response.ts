/** Bound JSON and SSE before the SDK allocates/parses complete messages. */
export function boundedMcpResponse(
  response: Response,
  limit = 1_048_576,
): Response {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_048_576)
    throw Error("Invalid MCP response limit");
  if (!response.body) return response;
  let total = 0;
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > limit) throw Error("MCP response exceeds limits");
        controller.enqueue(chunk);
      },
    }),
  );
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(body, { status: response.status, headers });
}
