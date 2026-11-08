import { it, expect } from "vitest";
import worker from "../src/worker.js";
const base = "https://amun.transfrm.ai";
it("serves the exact public Amun origin and rejects unknown hosts and routes", async () => {
  const home = worker.fetch(new Request(base));
  expect(home.status).toBe(200);
  expect(await home.text()).toContain("<title>Amun</title>");
  expect(worker.fetch(new Request("https://example.org")).status).toBe(404);
  expect(worker.fetch(new Request(base + "/missing")).status).toBe(404);
});
it("rejects unsolicited callbacks with no-store and never reflects the code or state", async () => {
  for (const query of ["", "?code=sample-secret&state=sample-state"]) {
    const r = worker.fetch(new Request(base + "/mcp/callback" + query));
    expect(r.status).toBe(400);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(await r.text()).not.toMatch(/sample-secret|sample-state/);
  }
  expect(worker.fetch(new Request(base, { method: "POST" })).status).toBe(405);
});
