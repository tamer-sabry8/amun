import { expect, test, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("the actual idle Firstmate branch executes only bounded local maintenance", async () => {
  test.skip(
    process.env.AMUN_LIVE_MAINTENANCE !== "1",
    "Opt-in real watcher with a loopback model",
  );
  test.setTimeout(180000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "amun-wake-")));
  let rounds = 0,
    drained = false,
    refused = false,
    cutoff = 0;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    const branch = input.tools?.some(
      (t: { function?: { name: string } }) =>
        t.function?.name === "fm_branch_report",
    );
    let delta: object = { content: "No further action." },
      finish = "stop";
    if (branch) {
      const outputs = (input.messages as { role: string; content: unknown }[])
        .filter((m) => m.role === "tool")
        .map((m) => JSON.stringify(m.content));
      drained ||= outputs.some(
        (s) => s.includes("WAKE_ACK_REQUIRED") || s.includes("wake drain:"),
      );
      refused ||= outputs.some((s) =>
        s.includes("Unattended action requires captain review"),
      );

      const ack = outputs
        .join(" ")
        .match(
          /bin\/fm-wake-drain[.]sh --ack-through ([0-9]+) --recovery-generation ([a-zA-Z0-9._-]+)/,
        )?.[0];
      const step = rounds++;
      const cmd =
        step === 0
          ? "bin/fm-wake-drain.sh"
          : step === 1
            ? "pwd"
            : step === 3
              ? ack
              : undefined;
      if (step === 3 && ack) cutoff = Number(ack.split(" ")[2]);
      if (cmd || step === 2) {
        delta = {
          tool_calls: [
            {
              index: 0,
              id: "maintenance" + rounds,
              type: "function",
              function: cmd
                ? { name: "bash", arguments: JSON.stringify({ command: cmd }) }
                : {
                    name: "fm_branch_report",
                    arguments: JSON.stringify({
                      task: "acceptance",
                      summary: "Observed the disposable worker report.",
                      verdict: "routine",
                      silent: true,
                    }),
                  },
            },
          ],
        };
        finish = "tool_calls";
      }
    }
    const chunk = (d: object, f: string | null) =>
      "data: " +
      JSON.stringify({
        id: "wake",
        object: "chat.completion.chunk",
        created: 1,
        model: "test",
        choices: [{ index: 0, delta: d, finish_reason: f }],
      }) +
      "\n\n";
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(
      chunk({ role: "assistant", ...delta }, null) +
        chunk({}, finish) +
        "data: [DONE]\n\n",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error();
  const agent = join(root, "pi-agent");
  await mkdir(agent, { mode: 0o700 });
  await writeFile(
    join(agent, "models.json"),
    JSON.stringify({
      providers: {
        "amun-local": {
          baseUrl: "http://127.0.0.1:" + addr.port + "/v1",
          api: "openai-completions",
          apiKey: "fixture",
          models: [{ id: "test", contextWindow: 64000, maxTokens: 1024 }],
        },
      },
    }),
    { mode: 0o600 },
  );
  await writeFile(
    join(agent, "settings.json"),
    JSON.stringify({ defaultProvider: "amun-local", defaultModel: "test" }),
    { mode: 0o600 },
  );
  const executablePath = process.env.AMUN_PACKAGED_PATH;
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [
      ...(executablePath ? [] : ["apps/desktop"]),
      "--user-data-dir=" + root,
    ],
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("status")).toHaveText("Connected");
    for (const name of ["Open conversations", "Open Pi commands"])
      await page.getByRole("button", { name, exact: true }).click();
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("afk");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Away posture is active",
      { timeout: 60000 },
    );
    const owner = (
      await readFile(join(root, "workspace/firstmate-crew-home"), "utf8")
    ).trim();
    const primary = join(root, "workspace", owner, "git/primary");
    await writeFile(
      join(primary, "config/supervision-branch-model"),
      "amun-local/test\n",
      { mode: 0o600 },
    );
    await writeFile(
      join(primary, "state/acceptance.meta"),
      "project=" + primary + "\nkind=scout\n",
      { mode: 0o600 },
    );
    await writeFile(
      join(root, "workspace", owner, "git/primary/state/acceptance.status"),
      "done: disposable local report\n",
      { mode: 0o600, flag: "wx" },
    );
    const state = join(primary, "state");
    await expect
      .poll(
        async () => {
          const recorded = await readFile(
            join(state, "branch-outcomes.jsonl"),
            "utf8",
          ).catch(() => "");
          const queue = await readFile(
            join(state, ".wake-queue"),
            "utf8",
          ).catch(() => "");
          const outstanding = queue
            .split("\n")
            .some(
              (line) =>
                line &&
                Number(line.split("\t")[1]) <= cutoff &&
                line.includes("acceptance"),
            );
          return {
            drained,
            refused,
            recorded: recorded.includes(
              "Observed the disposable worker report.",
            ),
            acknowledged: cutoff > 0 && !outstanding,
          };
        },
        { timeout: 100000 },
      )
      .toEqual({
        drained: true,
        refused: true,
        recorded: true,
        acknowledged: true,
      });
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 12,
      retryDelay: 200,
    });
  }
});
