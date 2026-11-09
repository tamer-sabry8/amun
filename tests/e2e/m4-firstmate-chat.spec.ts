import {
  acceptanceDrafts,
  acceptanceDb,
} from "../support/ado-acceptance-drafts.ts";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
test("Firstmate streams a selected story conversation and processes steering and follow-up on the Mac", async () => {
  const modelFile = process.env.AMUN_M2_GGUF;
  test.skip(!modelFile, "Set AMUN_M2_GGUF to an installed local chat model.");
  test.setTimeout(360000);
  const root = await mkdtemp(join(tmpdir(), "amun-m4-chat-"));
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
      "acceptance",
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
              { id: "acceptance", contextWindow: 8192, maxTokens: 2048 },
            ],
          },
        },
      }),
      { mode: 0o600 },
    );
    const ctx = await acceptanceDrafts(
      root,
      "https://example.test/Collection/",
      "Library",
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
    const composer = page.getByRole("region", {
      name: "Firstmate conversation",
    });
    const input = composer.getByLabel("Ask Firstmate");
    await composer
      .getByLabel("Conversation context")
      .selectOption(ctx.storyDrafts[0]!.id);
    await input.fill(
      "Quote the selected item's requirement, then explain it in four sentences.",
    );
    await button("Send to Firstmate").click();
    await expect(composer.getByLabel("Streaming Firstmate reply")).toBeVisible({
      timeout: 90000,
    });
    await input.fill("Briefly explain the visible result.");
    await button("Steer Firstmate").click();
    await expect(composer).toContainText("Steering queued");
    await input.fill("Summarize this conversation in one sentence.");
    await button("Queue follow-up").click();
    await expect(composer).toContainText("Follow-up queued");
    await expect(composer.getByText("Conversation history (3)")).toBeVisible({
      timeout: 120000,
    });
    await expect(composer.getByLabel("Latest Firstmate reply")).not.toBeEmpty();
    const db = acceptanceDb(root);
    try {
      const turns = db
        .prepare(
          "SELECT model,state,selection FROM firstmate_chat ORDER BY rowid",
        )
        .all();
      expect(turns).toHaveLength(3);
      for (const t of turns)
        expect(t).toMatchObject({
          state: "answered",
          model: "local/acceptance",
          selection: ctx.storyDrafts[0]!.id,
        });
      expect(db.prepare("SELECT count(*) AS n FROM actions").get()).toEqual({
        n: 0,
      });
    } finally {
      db.close();
    }
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
