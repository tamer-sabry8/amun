import { afterAll, afterEach, beforeAll, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { azureTransport } from "../src/transport.ts";
import { AdoProofClient } from "../src/client.ts";
const base = "https://devops.example.test/Collection/";
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
it("sends the SDK PAT header and revision patch with explicit 7.0", async () => {
  let calls = 0;
  server.use(
    http.patch(base + "ICV/_apis/wit/workitems/12", async ({ request }) => {
      calls++;
      expect(new URL(request.url).searchParams.get("api-version")).toBe("7.0");
      expect(request.headers.get("authorization")).toBe(
        "Basic " + Buffer.from("PAT:test-canary").toString("base64"),
      );
      expect(request.headers.get("content-type")).toBe(
        "application/json-patch+json",
      );
      expect(await request.json()).toEqual([
        { op: "test", path: "/rev", value: 2 },
        {
          op: "add",
          path: "/fields/System.Description",
          value: "Test revision precondition verified.",
        },
      ]);
      return HttpResponse.json({ id: 12, rev: 3 });
    }),
  );
  expect(
    await new AdoProofClient(
      base,
      "ICV",
      azureTransport(base, "test-canary"),
    ).update(12, 2),
  ).toEqual({ id: 12, rev: 3 });
  expect(calls).toBe(1);
});
it.each([400, 401, 403, 412, 429, 503])(
  "handles HTTP %s once without exposing the server body",
  async (status) => {
    let calls = 0;
    server.use(
      http.patch(base + "ICV/_apis/wit/workitems/12", () => {
        calls++;
        return HttpResponse.json({ message: "secret-canary" }, { status });
      }),
    );
    const expected =
      status === 412
        ? "revision_conflict"
        : status === 503
          ? "write_outcome_unknown"
          : `request_rejected_${status}`;
    await expect(
      new AdoProofClient(
        base,
        "ICV",
        azureTransport(base, "test-canary"),
      ).update(12, 2),
    ).rejects.toThrow(expected);
    expect(calls).toBe(1);
  },
);
it("does not follow credential-bearing redirects", async () => {
  let escaped = 0;
  server.use(
    http.patch(
      base + "ICV/_apis/wit/workitems/12",
      () =>
        new HttpResponse(null, {
          status: 302,
          headers: { Location: "https://evil.example.test/steal" },
        }),
    ),
    http.all("https://evil.example.test/steal", () => {
      escaped++;
      return HttpResponse.json({ id: 12, rev: 3 });
    }),
  );
  await expect(
    new AdoProofClient(base, "ICV", azureTransport(base, "test-canary")).update(
      12,
      2,
    ),
  ).rejects.toThrow("request_rejected_302");
  expect(escaped).toBe(0);
});
it("retains the server pagination token for discovery reads", async () => {
  server.use(
    http.get(base + "boards", () =>
      HttpResponse.json(
        { value: [] },
        { headers: { "x-ms-continuationtoken": "next" } },
      ),
    ),
  );
  expect(
    await azureTransport(base, "test-canary")("GET", base + "boards"),
  ).toMatchObject({ status: 200, continuationToken: "next" });
});
