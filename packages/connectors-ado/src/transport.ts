import { WebApi, getPersonalAccessTokenHandler } from "azure-devops-node-api";
import type { Transport } from "./client.ts";
/** Use the supported SDK transport, explicitly pinning routes in the proof client to Server 2022 API 7.0. */
export function azureTransport(base: string, pat: string): Transport {
  const api = new WebApi(base, getPersonalAccessTokenHandler(pat, false), {
    allowRetries: false,
    maxRetries: 0,
    allowRedirects: false,
    socketTimeout: 15000,
  });
  return async (method, url, body) => {
    if (!url.startsWith(base) || new URL(url).origin !== new URL(base).origin)
      throw new Error("Scope mismatch");
    try {
      const options = {
        additionalHeaders: { "Content-Type": "application/json-patch+json" },
      };
      const result =
        method === "GET"
          ? await api.rest.get(url)
          : method === "POST"
            ? await api.rest.create(url, body, options)
            : method === "PATCH"
              ? await api.rest.update(url, body, options)
              : null;
      if (!result) throw new Error("Unsupported method");
      return { status: result.statusCode, data: result.result };
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
