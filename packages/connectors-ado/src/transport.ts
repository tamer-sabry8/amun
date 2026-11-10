import type { Transport } from "./client.ts";
/** Use the supported SDK transport, explicitly pinning routes in the proof client to Server 2022 API 7.0. */
export function azureTransport(base: string, pat: string): Transport {
  let api:
    | Promise<InstanceType<typeof import("azure-devops-node-api").WebApi>>
    | undefined;
  return async (method, url, body) => {
    if (!url.startsWith(base) || new URL(url).origin !== new URL(base).origin)
      throw new Error("Scope mismatch");
    try {
      const client = await (api ??= import("azure-devops-node-api").then(
        ({ WebApi, getPersonalAccessTokenHandler }) =>
          new WebApi(base, getPersonalAccessTokenHandler(pat, false), {
            allowRetries: false,
            maxRetries: 0,
            allowRedirects: false,
            socketTimeout: 15000,
          }),
      ));
      const options = {
        additionalHeaders: {
          "Content-Type": Array.isArray(body)
            ? "application/json-patch+json"
            : "application/json",
        },
      };
      const result =
        method === "GET"
          ? await client.rest.get(url)
          : method === "POST"
            ? await client.rest.create(url, body, options)
            : method === "PUT"
              ? await client.rest.replace(url, body, options)
              : method === "PATCH"
                ? await client.rest.update(url, body, options)
                : null;
      if (!result) throw new Error("Unsupported method");
      const token =
        "x-ms-continuationtoken" in result.headers
          ? result.headers["x-ms-continuationtoken"]
          : undefined;
      return {
        status: result.statusCode,
        data: result.result,
        ...(typeof token === "string" && token
          ? { continuationToken: token }
          : {}),
      };
    } catch (error) {
      // Never propagate SDK response bodies, request headers, or credentials.
      const status =
        error && typeof error === "object" && "statusCode" in error
          ? error.statusCode
          : undefined;
      if (typeof status === "number") return { status, data: null };
      throw new Error("Azure transport failed");
    }
  };
}
