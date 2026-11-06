/** Select an access token for the installed CLI's supported stdin login. No refresh material is reused.
 * Expiry inspection is only a local guard; the CLI/provider must validate the actual credential. */
export function selectedCodexAccessToken(
  input: unknown,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  try {
    if (!input || typeof input !== "object") throw new Error();
    const data = input as Record<string, unknown>;
    if (
      data.auth_mode !== "chatgpt" ||
      (data.OPENAI_API_KEY !== undefined && data.OPENAI_API_KEY !== null) ||
      !data.tokens ||
      typeof data.tokens !== "object"
    )
      throw new Error();
    const token = (data.tokens as Record<string, unknown>).access_token;
    if (
      typeof token !== "string" ||
      token.length > 16384 ||
      !/^[-a-zA-Z0-9_]+\.[-a-zA-Z0-9_]+\.[-a-zA-Z0-9_]+$/.test(token)
    )
      throw new Error();
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      typeof claims.exp !== "number" ||
      !Number.isFinite(claims.exp) ||
      !Number.isFinite(nowSeconds) ||
      claims.exp < nowSeconds + 300
    )
      throw new Error();
    return token;
  } catch {
    throw new Error("Codex access token unavailable");
  }
}
