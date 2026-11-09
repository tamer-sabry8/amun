import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
test("Firstmate turns an approved PRD into linked stories and resolves a story decision on the Mac", async () => {
  const modelFile = process.env.AMUN_M2_GGUF;
  test.skip(!modelFile, "Set AMUN_M2_GGUF to an installed local chat model.");
  test.setTimeout(360000);
  const root = await mkdtemp(join(tmpdir(), "amun-m2-live-"));
  const socket = createServer();
  await new Promise<void>((done) => socket.listen(0, "127.0.0.1", done));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((done) => socket.close(() => done()));
  const server = spawn(
    "/opt/homebrew/bin/llama-server",
    [
      "-m",
      modelFile!,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--alias",
      "amun-local",
      "--ctx-size",
      "8192",
      "--parallel",
      "1",
      "--reasoning-budget",
      "0",
    ],
    { stdio: "ignore" },
  );
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await expect
      .poll(
        async () => {
          if (server.exitCode !== null)
            throw Error("Local model server exited " + server.exitCode);
          return (
            await fetch("http://127.0.0.1:" + port + "/health").catch(
              () => null,
            )
          )?.status;
        },
        { timeout: 65000 },
      )
      .toBe(200);
    const agent = join(root, "pi-agent");
    await mkdir(agent, { mode: 0o700 });
    await writeFile(
      join(agent, "models.json"),
      JSON.stringify({
        providers: {
          local: {
            baseUrl: "http://127.0.0.1:" + port + "/v1",
            api: "openai-completions",
            apiKey: "local-only",
            models: [
              { id: "amun-local", contextWindow: 8192, maxTokens: 2048 },
            ],
          },
        },
      }),
      { mode: 0o600 },
    );
    app = await electron.launch({
      args: [
        ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
        "--user-data-dir=" + root,
      ],
      ...(process.env.AMUN_PACKAGED_PATH
        ? { executablePath: process.env.AMUN_PACKAGED_PATH }
        : {}),
    });
    const page = await app.firstWindow(),
      button = (name: string) =>
        page.getByRole("button", { name, exact: true });
    await expect(page.locator("#service-status")).toHaveText("Connected");
    await page
      .getByRole("combobox", { name: "Product", exact: true })
      .selectOption({ label: "New product…" });
    await page.getByLabel("Product name").pressSequentially("Amun");
    await page
      .getByLabel("Allowed models (comma-separated IDs)")
      .pressSequentially("local/amun-local");
    await button("Create product").click();
    await mkdir(test.info().outputDir, { recursive: true });
    const rules = "Library members may renew each eligible loan once.";
    await page.getByLabel("Import document").setInputFiles({
      name: "Library-policy.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(rules),
    });
    const objective = "Allow library members to renew eligible loans.";
    await page.getByLabel("Product objective").fill(objective);
    await button("Start Firstmate interview").click();
    await expect(page.getByTestId("requests-count")).toHaveText("1", {
      timeout: 145000,
    });
    await button("Overview").click();
    await page.getByTestId("tool-tile").filter({ hasText: "Requests" }).click();
    const request = page.locator(".request-list button").first();
    if (await request.count()) await request.click();
    const answer = "Members may renew an eligible loan once.";
    await page.getByLabel("Your answer").fill(answer);
    await button("Save answer").click();
    await expect(page.getByTestId("requests-count")).toHaveText("0");
    await button("Close inspector").click();
    await button("PRD").click();
    await test.info().attach("prd-entry", {
      body: await page.locator("main").ariaSnapshot(),
      contentType: "text/plain",
    });
    await page.getByLabel("Facts", { exact: true }).fill(answer);
    await page
      .getByLabel("Assumptions", { exact: true })
      .fill("Members can borrow multiple books.");
    await page
      .getByLabel("Open questions")
      .fill("When should a reminder be sent?");
    await button("Save understanding").click();
    await button("Approve understanding").click();
    await expect(page.getByText("Understanding v1 · Approved")).toBeVisible();
    await page.getByRole("tab", { name: "Write", exact: true }).click();
    const editor = page.getByRole("textbox", {
      name: "PRD Markdown",
      exact: true,
    });
    const requirement = "Members can renew an eligible loan once.";
    await editor.fill("# Loan renewal\n\n" + requirement);
    await expect(page.getByLabel("PRD approval status")).toContainText(
      "Draft PRD v1",
    );
    await page.getByRole("tab", { name: "Review", exact: true }).click();
    await button("Approve PRD v1").click();
    await button("Generate stories").click();
    await expect(page.getByText("Story drafts ready in Backlog.")).toBeVisible({
      timeout: 120000,
    });
    await button("Backlog").click();
    const drafts = page.getByRole("region", { name: "Story drafts" });
    await expect(drafts).toContainText("REQ-");
    await expect(drafts.locator("blockquote").first()).toContainText("renew");
    await drafts
      .getByRole("button", { name: "Ask Firstmate for decision options" })
      .first()
      .click();
    const review = page.getByRole("region", { name: "Story decision" }).first();
    await expect(review).toBeVisible({ timeout: 120000 });
    await expect(review).toContainText("Unapproved");
    await review.getByRole("button", { name: "Save proposed answer" }).click();
    await review.getByRole("button", { name: "Request confirmation" }).click();
    await expect(review).toContainText("Confirmation requested");
    await review.getByRole("button", { name: "Later", exact: true }).click();
    await button("Decisions").click();
    const blockers = page.getByRole("region", { name: "Story blockers" });
    await expect(blockers).toContainText("Owner · Product manager");
    await expect(blockers).toContainText("Next action");
    await blockers
      .getByLabel("Confirmation evidence")
      .fill("Approved fixture policy reviewed by the PM");
    await blockers.getByRole("button", { name: "Resolve decision" }).click();
    await expect(blockers).toContainText("No outstanding story decisions.");
    await button("Backlog").click();
    await expect(drafts).toContainText("Resolved ·");
  } finally {
    await app?.close();
    server.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => {
        if (server.exitCode !== null) resolve();
        else server.once("exit", () => resolve());
      }),
      delay(3000),
    ]);
    if (server.exitCode === null && !server.signalCode) server.kill("SIGKILL");
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 12,
      retryDelay: 250,
    });
  }
});
