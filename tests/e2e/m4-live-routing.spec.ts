import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acceptanceDb } from "../support/ado-acceptance-drafts.ts";
test("separately approved routing uses both configured live providers and records both verified replies", async () => {
  const source = process.env.AMUN_M4_PROVIDER_AUTH;
  test.skip(
    !source,
    "Requires an approved Amun acceptance profile with both provider connections.",
  );
  test.setTimeout(210000);
  const root = await mkdtemp(join(tmpdir(), "amun-m4-routing-"));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const auth = JSON.parse(await readFile(source!, "utf8"));
    const scoped = Object.fromEntries(
      ["github-copilot", "openrouter"].map((provider) => {
        if (!auth[provider]) throw Error("Missing acceptance provider");
        return [provider, auth[provider]];
      }),
    );
    await mkdir(join(root, "pi-agent"), { mode: 0o700 });
    await writeFile(
      join(root, "pi-agent", "auth.json"),
      JSON.stringify(scoped),
      { mode: 0o600, flag: "wx" },
    );
    const executablePath = process.env.AMUN_PACKAGED_PATH;
    app = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [
        ...(executablePath ? [] : ["apps/desktop"]),
        "--user-data-dir=" + root,
      ],
    });
    const page = await app.firstWindow(),
      button = (name: string) =>
        page.getByRole("button", { name, exact: true });
    await expect(page.locator("#service-status")).toHaveText("Connected");
    await page
      .getByRole("combobox", { name: "Product", exact: true })
      .selectOption({ label: "New product…" });
    await page.getByLabel("Product name").fill("Route acceptance");
    const copilot = "github-copilot/gpt-5.4-nano",
      router = "openrouter/openai/gpt-4.1-mini";
    await page.getByLabel("Allowed models (comma-separated IDs)").fill(copilot);
    await button("Create product").click();
    await page.getByText("Model routing", { exact: true }).click();
    for (const [level, model] of [
      ["standard", copilot],
      ["complex", router],
    ] as const) {
      await page.getByLabel("Routing difficulty").selectOption(level);
      await page.getByLabel("Route model ID").fill(model);
      await button("Save route").click();
      if (level === "complex") await button("Approve model route").click();
      await expect(page.getByLabel("Saved model routes")).toContainText(model);
      await page.getByLabel("Conversation difficulty").selectOption(level);
      await page
        .getByLabel("Ask Firstmate", { exact: true })
        .fill("Reply with exactly: READY");
      await button("Send to Firstmate").click();
      await expect(
        page.getByText(
          "Conversation history (" + (level === "standard" ? 1 : 2) + ")",
          { exact: true },
        ),
      ).toBeVisible({ timeout: 95000 });
      await expect(page.getByLabel("Latest Firstmate reply")).toContainText(
        "READY",
      );
    }
    const db = acceptanceDb(root);
    try {
      expect(
        db
          .prepare("SELECT model,state FROM firstmate_chat ORDER BY rowid")
          .all(),
      ).toEqual(
        [copilot, router].map((model) => ({ model, state: "answered" })),
      );
      expect(
        db
          .prepare(
            "SELECT count(*) AS n FROM approvals WHERE kind='model_outside_allowlist'",
          )
          .get(),
      ).toEqual({ n: 1 });
      expect(
        db
          .prepare(
            "SELECT model FROM runs WHERE state='completed' ORDER BY rowid",
          )
          .all(),
      ).toEqual([copilot, router].map((model) => ({ model })));
    } finally {
      db.close();
    }
  } finally {
    await app?.close();
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 250,
    });
  }
});
