// Azure DevOps Server 2022 over REST 7.0 with a personal access token sent as
// Basic auth (empty user name), the supported PAT path. Replaces Beta 0.9's
// SDK transport with fetch; the error handling keeps the same guarantees:
// only Azure's redacted refusal text and error code leave this function.
import type { Transport } from "./ado-client.ts";
import { isMissingTypeText, redactAdoMessage } from "./ado-governed-writes.ts";

export const ADO_TIMEOUT_MS = 15_000;

export function fetchTransport(
  base: string,
  pat: string,
  fetchImpl: typeof fetch = fetch,
): Transport {
  const origin = new URL(base).origin;
  const auth = "Basic " + Buffer.from(":" + pat).toString("base64");
  return async (method, url, body) => {
    if (!url.startsWith(base) || new URL(url).origin !== origin)
      throw new Error("Scope mismatch");
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(ADO_TIMEOUT_MS),
        headers: {
          Authorization: auth,
          Accept: "application/json",
          ...(body === undefined
            ? {}
            : {
                "Content-Type": Array.isArray(body)
                  ? "application/json-patch+json"
                  : "application/json",
              }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error("Azure transport failed");
    }
    // A sign-in page or redirect means the token was not accepted.
    const status =
      response.status === 203 ||
      (response.status >= 300 && response.status < 400)
        ? 401
        : response.status;
    const text = await response.text().catch(() => "");
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (status >= 200 && status < 300) {
      const token = response.headers.get("x-ms-continuationtoken");
      return { status, data, ...(token ? { continuationToken: token } : {}) };
    }
    const fields =
      data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const message = redactAdoMessage(
      typeof fields.message === "string" ? fields.message : "",
    );
    const missing =
      (status === 400 || status === 404) && isMissingTypeText(message);
    const code =
      typeof fields.typeKey === "string"
        ? fields.typeKey
        : missing
          ? "WorkItemTypeDoesNotExistException"
          : typeof fields.errorCode === "number" ||
              typeof fields.errorCode === "string"
            ? String(fields.errorCode)
            : "";
    return {
      status,
      data:
        message || code
          ? { ...(code ? { typeKey: code } : {}), message }
          : null,
    };
  };
}
