import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
test("Firstmate drafts a PRD for a synthetic lending library", async () => {
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
    await page.getByLabel("Product name").pressSequentially("Lending Library");
    await page
      .getByLabel("Allowed models (comma-separated IDs)")
      .pressSequentially("local/amun-local");
    await button("Create product").click();
    await mkdir(test.info().outputDir, { recursive: true });
    const rules =
      "Each loan has a due date. Members can renew an available copy once.";
    await page.getByLabel("Import document").setInputFiles({
      name: "lending-policy.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(rules),
    });
    const objective =
      "Help library members renew eligible loans before their due date.";
    await page.getByLabel("Product objective").fill(objective);
    await button("Start Firstmate interview").click();
    await expect(page.getByTestId("requests-count")).toHaveText("1", {
      timeout: 145000,
    });
    await button("Overview").click();
    await page.getByTestId("tool-tile").filter({ hasText: "Requests" }).click();
    const request = page.locator(".request-list button").first();
    if (await request.count()) await request.click();
    const answer =
      "Permit one renewal per loan. A reserved copy must be returned on time.";
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
      .fill("A member can have multiple loans.");
    await page
      .getByLabel("Open questions")
      .fill("Which reminder time do members prefer?");
    await button("Save understanding").click();
    await button("Approve understanding").click();
    await expect(page.getByText("Understanding v1 · Approved")).toBeVisible();
    await button("Draft PRD from objective").click();
    await expect(button("Apply proposal")).toBeVisible({ timeout: 135000 });
    await button("Apply proposal").click();
    await button("Approve PRD v1").click();
    await expect(page.getByLabel("PRD approval status")).toHaveText(
      "Approved PRD v1",
    );
    const approvalStatus = page.getByLabel("PRD approval status");
    await approvalStatus.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: test.info().outputPath("approved-prd-v1.png"),
    });
    const Database = createRequire(resolve("packages/data/package.json"))(
      "better-sqlite3",
    );
    const db = new Database(join(root, "workspace/workspace.sqlite"), {
      readonly: true,
    });
    try {
      const row = db
        .prepare(
          "SELECT p.markdown,q.model,q.context_json,a.payload_hash FROM prds p JOIN prd_proposals q ON q.objective_id=p.objective_id JOIN prd_versions v ON v.prd_id=p.id JOIN approvals a ON a.prd_version_id=v.id WHERE q.state='applied'",
        )
        .get();
      expect(row.markdown).toMatch(/\[S1\]/);
      expect(JSON.parse(row.context_json).understanding).toMatchObject({
        approved: true,
        version: 1,
        facts: answer,
      });
      expect(row.payload_hash).toMatch(/^[a-f0-9]{64}$/);
      const evidence = {
        model: row.model,
        objective,
        question: db
          .prepare("SELECT ask FROM attention_items WHERE type='answer'")
          .get().ask,
        answer,
        approvedUnderstanding: JSON.parse(row.context_json).understanding,
        sources: db.prepare("SELECT id,title,hash FROM sources").all(),
        approvalHash: row.payload_hash,
      };
      await writeFile(
        test.info().outputPath("approved-prd-v1.md"),
        row.markdown,
      );
      await writeFile(
        test.info().outputPath("acceptance.json"),
        JSON.stringify(evidence, null, 2),
      );
    } finally {
      db.close();
    }
    await page.getByRole("tab", { name: "Write", exact: true }).click();
    const md = page.getByRole("textbox", { name: "PRD Markdown", exact: true });
    const before = await md.inputValue();
    await md.fill(
      before +
        "\n\nA reviewer must see which PRD version superseded an approval.",
    );
    await expect(page.getByLabel("PRD approval status")).toContainText(
      "Editing v1 invalidated its approval",
    );
    await expect(page.getByLabel("PRD approval status")).toContainText(
      "Draft PRD v2",
    );
    await approvalStatus.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: test.info().outputPath("approval-invalidated.png"),
    });
    const readback = new Database(join(root, "workspace/workspace.sqlite"), {
      readonly: true,
    });
    try {
      const row = readback
        .prepare(
          "SELECT p.version AS currentVersion,v.version AS previouslyApprovedVersion,a.invalidated_reason AS reason FROM approvals a JOIN prd_versions v ON a.prd_version_id=v.id JOIN prds p ON p.id=v.prd_id",
        )
        .get();
      expect(row).toMatchObject({
        currentVersion: 2,
        previouslyApprovedVersion: 1,
        reason: expect.stringContaining("invalidated"),
      });
      await writeFile(
        test.info().outputPath("invalidation.json"),
        JSON.stringify(row, null, 2),
      );
    } finally {
      readback.close();
    }
    await page.getByRole("tab", { name: "Research", exact: true }).click();
    await expect(
      page.getByText("lending-policy.md", { exact: false }).first(),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Review", exact: true }).click();
    await button("Ask Firstmate for critique").click();
    await expect(button("Dismiss proposal")).toBeVisible({ timeout: 135000 });
    await button("Dismiss proposal").click();
    await expect(button("Dismiss proposal")).toHaveCount(0);
    await expect(approvalStatus).toContainText("Draft PRD v2");
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
