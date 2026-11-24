import { request as httpRequest } from "node:http";
import { describe, expect, it, afterEach } from "vitest";
import {
  OutputPreviewHost,
  PREVIEW_CSP,
  type PreviewSnapshotLike,
} from "./output-preview.js";

const SYNTHETIC_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Synthetic Checkout</title></head>
<body>
  <h1>Checkout Wireframe</h1>
  <button id="next" onclick="document.getElementById('state').textContent='Step 2'">Next</button>
  <p id="state">Step 1</p>
</body>
</html>`;

function makeSnapshot(): PreviewSnapshotLike {
  return {
    setup: { activeGroupId: "g1" },
    areas: [
      { id: "area-a", groupId: "g1" },
      { id: "area-b", groupId: "g2" },
    ],
    library: [
      {
        id: "out-proto",
        groupId: "g1",
        type: "prototype",
        title: "Checkout Flow Wireframe",
        body: SYNTHETIC_HTML,
        version: 2,
        workAreaIds: ["area-a"],
      },
      {
        id: "out-url-only",
        groupId: "g1",
        type: "prototype",
        title: "Local Dev Link",
        body: "Open http://localhost:3000/secret",
        version: 1,
        workAreaIds: ["area-a"],
      },
      {
        id: "out-prd",
        groupId: "g1",
        type: "prd",
        title: "Checkout PRD",
        body: "# PRD\nNot a wireframe",
        version: 1,
        workAreaIds: ["area-a"],
      },
    ],
  };
}

describe("OutputPreviewHost", () => {
  const hosts: OutputPreviewHost[] = [];

  afterEach(async () => {
    await Promise.all(hosts.map((h) => h.closeAll()));
    hosts.length = 0;
  });

  it("serves a verified self-contained HTML wireframe on loopback with strict offline CSP", async () => {
    const host = new OutputPreviewHost();
    hosts.push(host);
    const opened = await host.open(makeSnapshot(), "out-proto", "area-a");
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(opened.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{64}$/);
    expect(opened.version).toBe(2);
    expect(opened.title).toBe("Checkout Flow Wireframe");

    const response = await fetch(opened.url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe(PREVIEW_CSP);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe(SYNTHETIC_HTML);

    // Wrong path returns 404.
    const wrongPath = new URL(opened.url);
    wrongPath.pathname = "/wrong";
    const missing = await fetch(wrongPath.href);
    expect(missing.status).toBe(404);

    // POST returns 405.
    const post = await fetch(opened.url, { method: "POST" });
    expect(post.status).toBe(405);

    // Mismatched Host header returns 404 (prevents DNS rebinding).
    const parsed = new URL(opened.url);
    const badHostStatus = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port: Number(parsed.port),
          path: parsed.pathname,
          method: "GET",
          headers: { Host: "evil.example.com" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(badHostStatus).toBe(404);
  });

  it("blocks cross-group previews, active-group mismatches, non-prototype artifacts, and external/local URL bodies", async () => {
    const host = new OutputPreviewHost();
    hosts.push(host);
    const snap = makeSnapshot();

    const crossGroup = await host.open(snap, "out-proto", "area-b");
    expect(crossGroup.ok).toBe(false);
    expect(crossGroup.message).toContain("different");

    // Omitting areaId still enforces setup.activeGroupId.
    const otherGroupSnap: PreviewSnapshotLike = {
      ...snap,
      setup: { activeGroupId: "g2" },
    };
    const activeGroupMismatch = await host.open(otherGroupSnap, "out-proto");
    expect(activeGroupMismatch.ok).toBe(false);
    expect(activeGroupMismatch.message).toContain("different work group");

    const nonProto = await host.open(snap, "out-prd", "area-a");
    expect(nonProto.ok).toBe(false);

    const urlOnly = await host.open(snap, "out-url-only", "area-a");
    expect(urlOnly.ok).toBe(false);
    expect(urlOnly.message).toContain("self-contained HTML");

    const missing = await host.open(snap, "does-not-exist", "area-a");
    expect(missing.ok).toBe(false);
    expect(host.activeCount).toBe(0);
  });

  it("enforces TTL expiration, max active preview cap, and clean shutdown", async () => {
    let clock = 1_000;
    const host = new OutputPreviewHost({
      ttlMs: 5_000,
      maxPreviews: 2,
      now: () => clock,
    });
    hosts.push(host);
    const snap = makeSnapshot();

    const first = await host.open(snap, "out-proto", "area-a");
    const second = await host.open(snap, "out-proto", "area-a");
    const third = await host.open(snap, "out-proto", "area-a");
    expect(first.ok && second.ok && third.ok).toBe(true);
    if (!first.ok || !second.ok || !third.ok) return;

    // Max 2 active: first was evicted and closed.
    expect(host.activeCount).toBe(2);
    await expect(fetch(first.url)).rejects.toThrow();

    // Advance past TTL: second returns 404 even before timer fires.
    clock += 6_000;
    const expired = await fetch(second.url);
    expect(expired.status).toBe(404);

    await host.closeAll();
    expect(host.activeCount).toBe(0);
    await expect(fetch(third.url)).rejects.toThrow();
  });
});
