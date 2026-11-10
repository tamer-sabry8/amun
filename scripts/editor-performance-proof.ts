import { expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  acceptanceDb,
  acceptanceDrafts,
} from "../tests/support/ado-acceptance-drafts.ts";
import { launchMacWorkspace } from "../tests/support/mac-workspace.ts";

const root = await mkdtemp(join(tmpdir(), "amun-editor-performance-"));
const context = await acceptanceDrafts(
  root,
  "https://example.invalid/Collection/",
  "Editor performance",
);
const db = acceptanceDb(root);
db.prepare(
  "INSERT INTO runs(id,product_id,agent_role,harness,state,started_at) VALUES(?,?,?,?,?,?)",
).run(
  "synthetic-performance-run",
  context.productId,
  "Engineer",
  "synthetic",
  "running",
  new Date().toISOString(),
);
db.close();
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end(
    "<!doctype html><title>Local performance fixture</title><h1>Local preview</h1>",
  );
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
if (!address || typeof address === "string")
  throw Error("Local fixture unavailable");
process.env.AMUN_PACKAGED_PATH = resolve(
  `apps/desktop/out/Amun-darwin-${process.arch}/Amun.app/Contents/MacOS/Amun`,
);
const app = await launchMacWorkspace(root);
try {
  const page = await app.firstWindow();
  await expect(page.locator("#service-status")).toHaveText("Connected");
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await button("PRD").click();
  await button("Visual mode").click();
  const editor = page.getByRole("textbox", { name: "Visual PRD editor" });
  await expect(editor).toBeVisible();
  await button("Browser").click();
  await page
    .getByLabel("Preview URL")
    .fill(`http://127.0.0.1:${address.port}/`);
  await button("Open preview").click();
  await expect(page.getByText("Page loaded", { exact: true })).toBeVisible();
  await button("Terminal").click();
  await expect(page.locator(".xterm-helper-textarea")).toHaveCount(1);
  await editor.click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.press("Enter");
  const samples: number[] = [];
  const text = "Measured typing in the Mac editor.";
  for (const char of text) {
    // Includes Playwright scheduling, DOM update and the next animation frame.
    const start = performance.now();
    await page.keyboard.type(char);
    await editor.evaluate(
      () => new Promise<void>((done) => requestAnimationFrame(() => done())),
    );
    samples.push(Math.round((performance.now() - start) * 10) / 10);
  }
  await expect(editor).toContainText(text);
  const sorted = [...samples].sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        packaged: true,
        platform: process.platform,
        arch: process.arch,
        samplesMs: samples,
        medianMs: sorted[Math.floor(sorted.length / 2)],
        p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
        maxMs: sorted.at(-1),
        browser: "scoped local WebContentsView",
        terminal: "open read-only PTY",
        run: "synthetic running record; no worker inference",
        contentVerified: true,
        limitations: [
          "Automation scheduling included",
          "Small synthetic PRD",
          "No prior PRD typing baseline or owner-selected editor budget",
          "External worker inference not included",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  await rm(root, { recursive: true, force: true });
}
