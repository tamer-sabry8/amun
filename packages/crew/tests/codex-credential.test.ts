import { it, expect } from "vitest";
import { selectedCodexAccessToken } from "../src/codex-credential.ts";
const now = 1000;
const token = (exp: number) =>
  "eyJhbGciOiJub25lIn0." +
  Buffer.from(JSON.stringify({ exp })).toString("base64url") +
  ".fixture";
it("selects only a non-expiring ChatGPT access token, not the refresh or ID token", () => {
  const access = token(2000);
  expect(
    selectedCodexAccessToken(
      {
        auth_mode: "chatgpt",
        OPENAI_API_KEY: null,
        tokens: {
          access_token: access,
          refresh_token: "do-not-copy",
          id_token: "do-not-copy",
          account_id: "private",
        },
      },
      now,
    ),
  ).toBe(access);
});
it("rejects unknown, ambiguous, malformed and near-expiry credentials", () => {
  for (const input of [
    null,
    {},
    { auth_mode: "apikey", tokens: { access_token: token(2000) } },
    {
      auth_mode: "chatgpt",
      OPENAI_API_KEY: "other",
      tokens: { access_token: token(2000) },
    },
    { auth_mode: "chatgpt", tokens: { access_token: token(1200) } },
    { auth_mode: "chatgpt", tokens: { access_token: "malformed" } },
    { auth_mode: "chatgpt", tokens: { access_token: "x".repeat(20000) } },
  ])
    expect(() => selectedCodexAccessToken(input, now)).toThrow(
      "Codex access token unavailable",
    );
});
