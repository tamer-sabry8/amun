import { connectionId, type Connection } from "./broker.ts";
/** Read-only identity checks. Redirects are never followed with credentials. */
export async function probeConnection(
  connection: Connection,
  secret: string,
  request: typeof fetch = fetch,
): Promise<boolean> {
  connectionId(connection);
  const base = new URL(connection.baseUrl);
  const headers: Record<string, string> = { Accept: "application/json" };
  let url: string;
  if (connection.kind === "ado") {
    url = base.href.replace(/\/$/, "") + "/_apis/connectionData";
    headers.Authorization =
      "Basic " + Buffer.from(":" + secret).toString("base64");
  } else if (connection.kind === "notion") {
    url = "https://api.notion.com/v1/users/me";
    headers.Authorization = "Bearer " + secret;
    headers["Notion-Version"] = "2026-03-11";
  } else {
    url =
      base.hostname === "github.com"
        ? "https://api.github.com/user"
        : base.origin + "/api/v3/user";
    headers.Authorization = "Bearer " + secret;
    headers.Accept = "application/vnd.github+json";
    if (base.hostname === "github.com")
      headers["X-GitHub-Api-Version"] = "2026-03-10";
  }
  try {
    const response = await request(url, {
      method: "GET",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (
      response.status !== 200 ||
      !response.headers.get("content-type")?.includes("application/json")
    ) {
      await response.body?.cancel();
      return false;
    }
    const reader = response.body?.getReader();
    if (!reader) return false;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 131072) {
          await reader.cancel();
          return false;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || typeof result !== "object") return false;
    if (connection.kind === "ado") {
      if (
        !("authenticatedUser" in result) ||
        !result.authenticatedUser ||
        typeof result.authenticatedUser !== "object"
      )
        return false;
      const user = result.authenticatedUser;
      return (
        "id" in user &&
        typeof user.id === "string" &&
        user.id.length > 0 &&
        user.id !== "00000000-0000-0000-0000-000000000000" &&
        "isActive" in user &&
        user.isActive === true
      );
    }
    if (connection.kind === "notion")
      return (
        "object" in result &&
        result.object === "user" &&
        "type" in result &&
        result.type === "bot" &&
        "id" in result &&
        typeof result.id === "string"
      );
    return (
      "id" in result &&
      typeof result.id === "number" &&
      result.id > 0 &&
      "login" in result &&
      typeof result.login === "string"
    );
  } catch {
    return false;
  }
}
