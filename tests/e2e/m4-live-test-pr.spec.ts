import { test, expect, _electron as electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { connectionId } from "../../packages/auth/src/broker.ts";
import { acceptanceDb } from "../support/ado-acceptance-drafts.ts";
test("packaged reviewer binds a native TEST review and merge decision to the exact TEST head", async () => {
  const lookup = process.env.AMUN_TEST_GITHUB_REPO,
    number = Number(process.env.AMUN_TEST_PR),
    head = process.env.AMUN_TEST_PR_HEAD,
    base = process.env.AMUN_TEST_PR_BASE;
  test.skip(
    !lookup || !number || !head || !base,
    "Requires an explicitly designated TEST PR and reviewed head.",
  );
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(lookup!) ||
    !base!.startsWith("test/") ||
    !/^[0-9a-f]{40}$/.test(head!)
  )
    throw Error("Invalid TEST review target.");
  const gh = (args: string[]) =>
    execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const read = () =>
    JSON.parse(gh(["api", "repos/" + lookup + "/pulls/" + number]));
  const initial = read();
  expect(initial.state).toBe("open");
  expect(initial.base.ref).toBe(base);
  expect(initial.head.sha).toBe(head);
  expect(initial.head.ref).toMatch(/^test\//);
  expect(initial.title).toMatch(/^TEST /);
  const files = JSON.parse(
    gh(["api", "repos/" + lookup + "/pulls/" + number + "/files"]),
  );
  expect(files.map((f: { filename: string }) => f.filename)).toEqual([
    "TEST.md",
  ]);
  test.setTimeout(180000);
  const root = await mkdtemp(join(tmpdir(), "test-pr-review-"));
  const executablePath = process.env.AMUN_PACKAGED_PATH;
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [
      ...(executablePath ? [] : ["apps/desktop"]),
      "--user-data-dir=" + root,
    ],
  });
  let erase: (() => Promise<unknown>) | undefined;
  try {
    const page = await app.firstWindow(),
      button = (name: string) =>
        page.getByRole("button", { name, exact: true });
    await expect(page.locator("#service-status")).toHaveText("Connected");
    const db = acceptanceDb(root);
    try {
      const row = db
        .prepare(
          "SELECT value_json FROM workspace_settings WHERE id='workspace_identity'",
        )
        .get() as { value_json: string };
      const conn = { kind: "github" as const, baseUrl: "https://github.com" },
        account = JSON.parse(row.value_json) + "/" + connectionId(conn);
      const { AsyncEntry } = createRequire(
        resolve("packages/connectors-ado/package.json"),
      )("@napi-rs/keyring");
      const entry = new AsyncEntry("ai.amun", account);
      if (await entry.getPassword())
        throw Error("Unexpected existing temporary credential.");
      await entry.setPassword(
        gh(["auth", "token", "--hostname", "github.com"]),
      );
      erase = () => entry.deletePassword();
      db.prepare(
        "INSERT INTO workspace_settings(id,value_json) VALUES('connections',?)",
      ).run(JSON.stringify([conn]));
    } finally {
      db.close();
    }
    await page
      .getByRole("combobox", { name: "Product", exact: true })
      .selectOption({ label: "New product…" });
    await page.getByLabel("Product name").fill("TEST review");
    await button("Create product").click();
    await page.getByLabel("Source type").selectOption("repo");
    await page.getByLabel("Source title").fill("TEST repository");
    await page
      .getByLabel("Source reference")
      .fill("https://github.com/" + lookup);
    await button("Map source").click();
    await expect(
      page.getByRole("region", { name: "Product context" }),
    ).toContainText("https://github.com/" + lookup);
    await button("PRs").click();
    await expect(page.locator("select[name=source] option")).toHaveText(
      "TEST repository",
    );
    await button("Load repository PRs").click();
    await expect(
      page
        .getByRole("region", { name: "Pull request workspace" })
        .getByRole("status"),
    ).toHaveText(/^[1-9][0-9]* open pull requests/, { timeout: 60000 });
    await page
      .getByRole("button", { name: new RegExp("TEST repository #" + number) })
      .click();
    await expect(
      page.getByRole("heading", { name: initial.title }),
    ).toBeVisible();
    await button("TEST.md").click();
    await expect(page.getByLabel("Diff summary")).toHaveText(
      "1 changed region",
    );
    const body =
      "TEST reviewed the synthetic sample result and verified the changed file.";
    const existing = JSON.parse(
      gh(["api", "repos/" + lookup + "/pulls/" + number + "/reviews"]),
    );
    if (
      !existing.some(
        (r: { body: string; commit_id: string }) =>
          r.body === body && r.commit_id === head,
      )
    ) {
      await page.getByLabel("Review action").selectOption("comment");
      await page.getByLabel("Review text").fill(body);
      await button("Submit PR review").click();
      await expect(
        page.getByText("Review submitted.", { exact: true }),
      ).toBeVisible({ timeout: 20000 });
    }
    await page.getByLabel("Merge method").selectOption("merge");
    await button("Prepare merge").click();
    const preview = page.getByRole("region", { name: "Exact merge review" });
    await expect(preview).toContainText(head!);
    await expect(preview).toContainText(base!);
    await expect(preview).toContainText("https://github.com/" + lookup);
    await button("Approve merge").click();
    await expect(button("Execute approved merge")).toBeVisible();
    await button("Execute approved merge").click();
    await expect(
      page.getByText("Merge verified.", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    const final = read();
    expect(final.merged).toBe(true);
    expect(final.head.sha).toBe(head);
    expect(final.base.ref).toBe(base);
  } finally {
    try {
      await app.close();
    } finally {
      await erase?.();
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 6,
        retryDelay: 200,
      });
    }
  }
});
