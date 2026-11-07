import { it, expect, vi } from "vitest";
import { nativeMcp } from "../src/native-mcp.ts";
it("lists requested connections without launching anything and omits Chroma", async () => {
  const send = vi.fn();
  const result = await nativeMcp("", send);
  expect(result.kind).toBe("choices");
  expect(JSON.stringify(result)).toContain("Chrome DevTools");
  expect(JSON.stringify(result)).not.toContain("Chroma");
  expect(send).not.toHaveBeenCalled();
});
it("probes only the official GitHub endpoint, refuses redirects and distinguishes an OAuth challenge from a connection", async () => {
  const send = vi.fn(
    async () =>
      new Response(null, {
        status: 401,
        headers: {
          "www-authenticate":
            'Bearer resource_metadata="https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/"',
        },
      }),
  );
  expect(await nativeMcp("github", send)).toMatchObject({
    kind: "message",
    text: expect.stringContaining("Sign-in required"),
  });
  expect(send).toHaveBeenCalledWith(
    "https://api.githubcopilot.com/mcp/",
    expect.objectContaining({ redirect: "error", credentials: "omit" }),
  );
  await expect(nativeMcp("https://example.org", send)).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
  expect(
    await nativeMcp("github", async () => new Response(null, { status: 403 })),
  ).toMatchObject({ text: expect.stringContaining("not verified") });
});
