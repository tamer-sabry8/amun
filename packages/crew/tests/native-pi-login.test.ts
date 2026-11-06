import { expect, it } from "vitest";
import { nativePiLoginChoice } from "../src/native-pi-login.ts";
it("routes a native login choice to the existing private auth broker", () => {
  expect(nativePiLoginChoice("").kind).toBe("choices");
  expect(nativePiLoginChoice("openai-codex:oauth")).toEqual({
    version: 1,
    kind: "auth",
    action: "login",
    provider: "openai-codex",
    type: "oauth",
  });
  expect(() => nativePiLoginChoice("notion:api_key")).toThrow();
  expect(() => nativePiLoginChoice("openai:oauth")).toThrow();
  expect(() => nativePiLoginChoice("https://evil.test")).toThrow();
});
