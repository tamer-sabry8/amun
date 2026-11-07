import { it, expect } from "vitest";
import { probeConnection } from "../src/probe.ts";
it("uses read-only supported identity endpoints and refuses redirects before credentials can escape", async () => {
  for (const connection of [
    { kind: "github" as const, baseUrl: "https://github.com" },
    { kind: "github" as const, baseUrl: "https://git.example" },
    { kind: "notion" as const, baseUrl: "https://api.notion.com" },
    { kind: "ado" as const, baseUrl: "https://devops.example/Collection" },
  ]) {
    let calls = 0;
    const ok = await probeConnection(
      connection,
      "secret",
      async (input, options) => {
        calls++;
        expect(options?.redirect).toBe("error");
        expect(options?.method).toBe("GET");
        expect(String(input)).not.toContain("secret");
        expect(new Headers(options?.headers).get("Authorization")).toBeTruthy();
        return new Response(
          JSON.stringify(
            connection.kind === "ado"
              ? { authenticatedUser: { id: "user", isActive: true } }
              : connection.kind === "notion"
                ? { object: "user", type: "bot", id: "bot" }
                : { id: 42, login: "user" },
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );
    expect(ok).toBe(true);
    expect(calls).toBe(1);
  }
});
it("does not treat HTML sign-in pages, public responses, authentication failures or malformed JSON as readiness", async () => {
  const connection = { kind: "github" as const, baseUrl: "https://github.com" };
  for (const response of [
    new Response("<html>Login</html>", {
      headers: { "Content-Type": "text/html" },
    }),
    new Response("{}", { status: 401 }),
    new Response("{}", { headers: { "Content-Type": "application/json" } }),
    new Response("not json", {
      headers: { "Content-Type": "application/json" },
    }),
  ])
    expect(
      await probeConnection(connection, "secret", async () => response),
    ).toBe(false);
  await expect(
    probeConnection(
      { kind: "github", baseUrl: "http://evil.test" },
      "secret",
      async () => {
        throw Error("Must not call");
      },
    ),
  ).rejects.toThrow();
});
