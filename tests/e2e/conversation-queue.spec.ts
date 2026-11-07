import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, realpath, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviewedExtensions } from "../../packages/crew/src/reviewed-extensions.ts";
test("native Pi queues, recalls and delivers a follow-up during a streaming turn", async () => {
  test.setTimeout(80000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "amun-queue-e2e-")));
  const requests: string[] = [];
  let release = () => {};
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(body);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta: object, finish: string | null) =>
      res.write(
        "data: " +
          JSON.stringify({
            id: "chat-test",
            object: "chat.completion.chunk",
            created: 1,
            model: "queue",
            choices: [{ index: 0, delta, finish_reason: finish }],
          }) +
          "\n\n",
      );
    chunk({ role: "assistant", content: "Queue " }, null);
    if (requests.length === 1)
      await new Promise<void>((done) => {
        release = done;
      });
    chunk({ content: "verified" }, "stop");
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error();
  const agent = join(root, "pi-agent");
  await mkdir(agent, { mode: 0o700 });
  const checked = await ReviewedExtensions.open(agent);
  const provider = {
    name: "Queue fixture",
    baseUrl: "http://127.0.0.1:" + addr.port + "/v1",
    apiKey: "disposable-queue",
    api: "openai-completions",
    models: [
      {
        type: "chat",
        id: "queue",
        name: "Queue acceptance",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 100,
      },
    ],
  };
  await checked.trust(
    checked.review(
      "queue.ts",
      'export default function(pi){pi.registerProvider("amun-queue",' +
        JSON.stringify(provider) +
        ");}",
    ).id,
  );
  await checked.close();
  const executablePath = process.env.AMUN_PACKAGED_PATH;
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [
      ...(executablePath ? [] : ["apps/desktop"]),
      "--user-data-dir=" + root,
    ],
  });
  try {
    const p = await app.firstWindow();
    const btn = (name: string) => p.getByRole("button", { name, exact: true });
    await expect(p.locator("#service-status")).toHaveText("Connected");
    await btn("Open conversations").click();
    await btn("Open Pi commands").click();
    await p.getByLabel("Native Pi command").selectOption("model");
    await btn("Run command").click();
    await btn("Queue acceptance").click({ timeout: 18000 });
    await btn("Read active conversation").click();
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
    await p.getByLabel("Conversation message").evaluate((el, encoded) => {
      const data = new DataTransfer();
      data.items.add(
        new File(
          [Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))],
          "pasted.png",
          { type: "image/png" },
        ),
      );
      el.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, clipboardData: data }),
      );
    }, png);
    await expect(
      p.getByRole("img", { name: "Image attached to this conversation" }),
    ).toBeVisible({ timeout: 1800 });
    await p
      .getByLabel("Conversation message")
      .fill("Begin the queue acceptance");
    await p.getByLabel("Conversation message").press("Enter");
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toContain("data:image/png;base64,");
    const queued = p.getByLabel("Message during response");
    await queued.fill("Recall this steering message", { timeout: 2400 });
    await btn("Steer response").click();
    await expect(
      p.getByRole("status").filter({ hasText: "Steering message queued" }),
    ).toBeVisible();
    await queued.press("Alt+ArrowUp");
    await expect(queued).toHaveValue("Recall this steering message");
    await queued.fill("Deliver this follow-up");
    await queued.press("Alt+Enter");
    await expect(
      p.getByRole("status").filter({ hasText: "Follow-up queued" }),
    ).toBeVisible();
    release();
    await expect.poll(() => requests.length, { timeout: 15000 }).toBe(2);
    expect(requests[1]).toContain("Deliver this follow-up");
    expect(requests[1]).not.toContain("Recall this steering message");
    await expect(p.getByLabel("Active conversation text")).toHaveValue(
      /Queue verified/,
    );
  } finally {
    release();
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
});
