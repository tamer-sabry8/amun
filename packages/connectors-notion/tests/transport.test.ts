import { expect, it, vi } from "vitest";
import { notionTransport } from "../src/transport.ts";
it("uses the official fixed HTTPS endpoint and refuses redirects with no retry", async () => {
  const request = vi.fn(
    async () => new Response('{"object":"page"}', { status: 200 }),
  );
  const send = notionTransport("CANARY_NOTION", request as typeof fetch);
  expect(await send({ parent: { page_id: "x" } })).toEqual({
    status: 200,
    data: { object: "page" },
  });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith(
    "https://api.notion.com/v1/pages",
    expect.objectContaining({
      method: "POST",
      redirect: "error",
      headers: expect.objectContaining({
        Authorization: "Bearer CANARY_NOTION",
        "Notion-Version": "2026-03-11",
      }),
    }),
  );
});
it("sanitizes failures and caps response size without retries", async () => {
  for (const response of [
    new Response("x".repeat(1048577)),
    new Response("not json"),
  ]) {
    const request = vi.fn(async () => response);
    await expect(
      notionTransport("CANARY", request as typeof fetch)({}),
    ).rejects.toThrow("Notion request outcome is unconfirmed");
    expect(request).toHaveBeenCalledTimes(1);
  }
  const request = vi.fn(async () => {
    throw Error("CANARY");
  });
  await expect(
    notionTransport("CANARY", request as typeof fetch)({}),
  ).rejects.toThrow("Notion request outcome is unconfirmed");
  expect(request).toHaveBeenCalledTimes(1);
});
it("rejects invalid credentials before creating a request", () => {
  for (const secret of ["", "x\nheader", "x".repeat(65537)])
    expect(() => notionTransport(secret)).toThrow();
});
it("allows only bounded Notion metadata GET routes without redirects", async () => {
  const { notionReadTransport } = await import("../src/transport.ts");
  const request = vi.fn(
    async () => new Response('{"object":"database"}', { status: 200 }),
  );
  const read = notionReadTransport("CANARY", request as typeof fetch);
  await read("/v1/databases/11111111-1111-4111-8111-111111111111");
  expect(request).toHaveBeenCalledWith(
    "https://api.notion.com/v1/databases/11111111-1111-4111-8111-111111111111",
    expect.objectContaining({ method: "GET", redirect: "error" }),
  );
  request.mockClear();
  for (const path of [
    "https://evil.test",
    "/v1/users/me?secret=x",
    "/v1/pages/../users",
    "/v1/pages/not-an-id",
  ])
    await expect(read(path)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
