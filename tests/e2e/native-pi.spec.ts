import { pathToFileURL } from "node:url";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
test("native Pi commands create an owned SDK session and update its real name", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "amun-native-ui-")));
  const cwd = join(root, "pi-workspace"),
    sessions = join(cwd, "sessions");
  await mkdir(sessions, { recursive: true, mode: 0o700 });
  const sdk = (await import(
    pathToFileURL(
      resolve(
        "runtime/pi/node_modules/@earendil-works/pi-coding-agent/dist/index.js",
      ),
    ).href
  )) as {
    SessionManager: {
      create(
        cwd: string,
        dir: string,
      ): {
        appendSessionInfo(name: string): string;
        branch(id: string): void;
        appendMessage(message: unknown): string;
      };
    };
  };
  const saved = sdk.SessionManager.create(cwd, sessions);
  const rootEntry = saved.appendSessionInfo("Saved session acceptance");
  const alternate = saved.appendMessage({
    role: "user",
    content: [{ type: "text", text: "Separate branch fixture" }],
    timestamp: Date.now(),
  });
  saved.branch(rootEntry);
  const activeUser = saved.appendMessage({
    role: "user",
    content: [
      { type: "text", text: "Saved session fixture password=AMUN_TEST_SECRET" },
    ],
    timestamp: Date.now(),
  });
  saved.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "Native clipboard acceptance" }],
    api: "openai-responses",
    provider: "openai",
    model: "fixture",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  });
  const app = await electron.launch({
    args: [
      ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
      "--user-data-dir=" + root,
    ],
    ...(process.env.AMUN_PACKAGED_PATH
      ? { executablePath: process.env.AMUN_PACKAGED_PATH }
      : {}),
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("status")).toHaveText("Connected");
    await page
      .getByRole("button", { name: "Open conversations", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open Pi commands", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Cycle thinking level", exact: true })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      /Thinking level:|no thinking levels to cycle/,
    );
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("mcp");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    const hostingMenu = page.getByRole("button", {
      name: "Choose workspace hosting",
      exact: true,
    });
    await hostingMenu.click();
    await expect(page.getByLabel("Hosting provider")).toHaveValue("");
    await page.getByLabel("Hosting provider").selectOption("other");
    await page.getByLabel("Publishing hostname").fill("work.example.org");
    await page
      .getByRole("button", { name: "Save hosting destination" })
      .click();
    await expect(
      page.getByText("Saved destination: work.example.org"),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await hostingMenu.click();
    await expect(page.getByLabel("Publishing hostname")).toHaveValue(
      "work.example.org",
    );
    await expect(
      page.getByRole("button", { name: "Inspect DNS in Cloudflare" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "GitHub · Sign in with Microsoft Edge",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "GitHub · Test saved connection",
        exact: true,
      })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Sign in with Microsoft Edge",
    );
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Chrome DevTools", exact: true })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Chrome DevTools verified a blank page in an isolated Chrome session.",
      { timeout: 25000 },
    );
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("name");
    await page
      .getByLabel("Command argument", { exact: true })
      .fill("Native session acceptance");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Native session acceptance",
      { timeout: 20000 },
    );
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("new");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Session change completed",
    );
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("name");
    await page.getByLabel("Command argument", { exact: true }).fill("");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Unnamed session",
    );
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("resume");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await page
      .getByTestId("native-pi-result")
      .getByRole("button", { name: "Saved session acceptance", exact: true })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Session change completed",
    );
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("tree");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "message · " + alternate + " · Level 2",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "message · " + activeUser + " · Level 2",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("list", { name: "Session tree entries" })
        .locator('[aria-current="step"]'),
    ).toHaveCount(1);
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("name");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Saved session acceptance",
    );
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("copy");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Native clipboard acceptance",
    );
    const clipboardBefore = await app.evaluate(({ clipboard }) =>
      clipboard.readText(),
    );
    try {
      await page
        .getByRole("button", { name: "Copy reply to clipboard", exact: true })
        .click();
      await expect(page.getByTestId("native-pi-result")).toContainText(
        "Copied to clipboard",
      );
      expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
        "Native clipboard acceptance",
      );
    } finally {
      await app.evaluate(
        ({ clipboard }, value) => clipboard.writeText(value),
        clipboardBefore,
      );
    }
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("settings");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await page
      .getByLabel("Automatic context compaction", { exact: true })
      .selectOption("false");
    await expect(
      page.getByLabel("Automatic context compaction", { exact: true }),
    ).toHaveValue("false");
    await page
      .getByLabel("Automatic context compaction", { exact: true })
      .selectOption("true");
    await expect(
      page.getByLabel("Automatic context compaction", { exact: true }),
    ).toHaveValue("true");
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("trust");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Do not trust this workspace", exact: true })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Trust decision saved",
    );
    for (const format of ["jsonl", "html"]) {
      await page
        .getByLabel("Native Pi command", { exact: true })
        .selectOption("export");
      await page.getByLabel("Command argument", { exact: true }).fill(format);
      await page
        .getByRole("button", { name: "Run command", exact: true })
        .click();
      await expect(
        page.getByLabel("Export review document", { exact: true }),
      ).toHaveValue(/Native clipboard acceptance/);
      await expect(
        page.getByRole("button", {
          name: "Save reviewed export…",
          exact: true,
        }),
      ).toBeVisible();
    }
    await page
      .getByRole("button", { name: "Read active conversation", exact: true })
      .click();
    await page
      .getByLabel("Conversation message", { exact: true })
      .fill("/tree");
    await page
      .getByRole("button", { name: "Run /tree", exact: true })
      .click({ timeout: 4000 });
    await expect(
      page.getByRole("list", { name: "Session tree entries" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Read active conversation", exact: true })
      .click();
    await page
      .getByLabel("Conversation message", { exact: true })
      .fill("/skill:updatefirstmate --apply");
    await page
      .getByRole("button", { name: "Run /updatefirstmate", exact: true })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Run /updatefirstmate without arguments",
    );
    await page
      .getByRole("button", { name: "Read active conversation", exact: true })
      .click();
    await page
      .getByLabel("Conversation message", { exact: true })
      .press("Control+l");
    await expect(
      page.getByLabel("Native Pi command", { exact: true }),
    ).toHaveValue("model", { timeout: 2000 });
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Select model",
    );
    await page
      .getByRole("button", { name: "Read active conversation", exact: true })
      .click();
    await page
      .getByLabel("Conversation message", { exact: true })
      .fill("/unsupported");
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Set up Notion sharing", exact: true })
      .click();
    await expect(page.getByLabel("Service", { exact: true })).toHaveValue(
      "notion",
    );
    await page
      .getByRole("button", { name: "Return to conversation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open Pi commands", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Read active conversation", exact: true })
      .click();
    await expect(
      page.getByLabel("Active conversation text", { exact: true }),
    ).toHaveValue(/Native clipboard acceptance/);
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("bug");
    await page
      .getByLabel("Command argument", { exact: true })
      .fill("Bug fixture password=BUG_REPORT_CANARY");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(
      page.getByLabel("Export review document", { exact: true }),
    ).toHaveValue(/Local bug report — not uploaded/);
    await expect(
      page.getByLabel("Export review document", { exact: true }),
    ).not.toHaveValue(/BUG_REPORT_CANARY/);
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("debug", { timeout: 3000 });
    await page.getByLabel("Command argument", { exact: true }).fill("");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    const diagnostic = page.getByLabel("Export review document", {
      exact: true,
    });
    await expect(diagnostic).toHaveValue(/amun-native-pi-debug/);
    await expect(diagnostic).toHaveValue(/Native clipboard acceptance/);
    await expect(diagnostic).not.toHaveValue(/BUG_REPORT_CANARY/);
    await page
      .getByRole("button", { name: "Read active conversation", exact: true })
      .click();
    await expect(
      page.getByLabel("Active conversation text", { exact: true }),
    ).toHaveValue(/Native clipboard acceptance/);
    await expect(
      page.getByLabel("Active conversation text", { exact: true }),
    ).not.toHaveValue(/AMUN_TEST_SECRET/);
    await page
      .getByRole("button", { name: "Share to Notion", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Review Share to Notion" }),
    ).toBeFocused();
    await expect(
      page.getByLabel("Redacted Notion conversation preview", { exact: true }),
    ).toHaveValue(/\[REDACTED\]/);
    await expect(
      page.getByLabel("Redacted Notion conversation preview", { exact: true }),
    ).not.toHaveValue(/AMUN_TEST_SECRET/);
    await expect(
      page.getByRole("button", {
        name: "Approve and publish this content",
        exact: true,
      }),
    ).toHaveCount(0);
    await page
      .getByRole("button", {
        name: "Review destination and exact publication",
        exact: true,
      })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "First check your Notion destination",
    );
    await expect(
      page.getByRole("button", {
        name: "Approve and publish this content",
        exact: true,
      }),
    ).toHaveCount(0);
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("share");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "no gist or Radius fallback",
    );
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("clone");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Session change completed",
    );
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("tree");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await page
      .getByTestId("native-pi-result")
      .getByRole("button", { name: /^message · / })
      .first()
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Session change completed",
    );
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("fork");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await page
      .getByTestId("native-pi-result")
      .getByRole("button", { name: "User message 1", exact: true })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Session change completed",
    );
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("changelog");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Pi changelog", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Page 2 of",
    );
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("hotkeys");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(page.getByTestId("native-pi-result")).toContainText("Ctrl+P");
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("quit");
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Open Pi commands", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "Connected" }),
    ).toBeVisible();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
