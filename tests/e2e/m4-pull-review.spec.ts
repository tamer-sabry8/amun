import { acceptanceDb } from "../support/ado-acceptance-drafts.ts";
import { execFileSync } from "node:child_process";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Mac PR review displays a diff and refuses execution after the approved Azure head changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-m4-pull-"));
  const key = join(root, "tls.key"),
    cert = join(root, "tls.pem"),
    conf = join(root, "tls.cnf");
  await writeFile(
    conf,
    "[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\n",
  );
  execFileSync(
    "/usr/bin/openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-config",
      conf,
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { stdio: "ignore" },
  );

  let head = "a".repeat(40),
    writes = 0,
    merged = false;
  const server = createServer(
    { key: await readFile(key), cert: await readFile(cert) },
    async (req, res) => {
      const u = new URL(req.url!, "https://127.0.0.1"),
        path = u.pathname;
      const git = "/Collection/Library/_apis/git/repositories/demo",
        pull = git + "/pullrequests/7";
      if (req.method === "PATCH" && path === pull) {
        let payload = "";
        for await (const chunk of req) payload += chunk;
        const change = JSON.parse(payload);
        if (
          change.lastMergeSourceCommit?.commitId !== head ||
          change.completionOptions?.bypassPolicy !== false
        ) {
          res.writeHead(409);
          res.end();
          return;
        }
        merged = true;
      }
      const rows: Record<string, unknown> = {
        [pull]: {
          pullRequestId: 7,
          title: "Review a change",
          description: "Review the change",
          status: merged ? "completed" : "active",
          mergeStatus: "succeeded",
          lastMergeSourceCommit: { commitId: head },
          lastMergeTargetCommit: { commitId: "c".repeat(40) },
          targetRefName: "refs/heads/main",
          sourceRefName: "refs/heads/demo",
          repository: { id: "repo", project: { id: "project" } },
          reviewers: [],
        },
        [pull + "/iterations"]: { value: [{ id: 1 }] },
        [pull + "/iterations/1/changes"]: {
          changeEntries: [{ changeType: "edit", item: { path: "/README.md" } }],
        },
        [pull + "/threads"]: { value: [] },
        [git + "/items"]: {
          content:
            u.searchParams.get("versionDescriptor.version") === head
              ? "Edited example"
              : "Original example",
        },
        "/Collection/Library/_apis/policy/evaluations": { value: [] },
        "/Collection/_apis/securitynamespaces": {
          value: [
            {
              namespaceId: "git",
              name: "Git Repositories",
              actions: [{ name: "GenericContribute", bit: 4 }],
            },
          ],
        },
        "/Collection/_apis/permissions/git/4": { value: [true] },
      };
      if (req.method !== "GET") writes++;
      res.writeHead(Object.hasOwn(rows, path) ? 200 : 404, {
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify(rows[path] ?? {}));
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const collection =
    "https://127.0.0.1:" +
    (server.address() as AddressInfo).port +
    "/Collection";
  const launch = () =>
    electron.launch({
      args: [
        ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
        "--user-data-dir=" + root,
      ],
      ...(process.env.AMUN_PACKAGED_PATH
        ? { executablePath: process.env.AMUN_PACKAGED_PATH }
        : {}),
      env: { ...process.env, NODE_EXTRA_CA_CERTS: cert },
    });
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  test.setTimeout(90000);
  let saved = false;
  try {
    app = await launch();
    const page = await app.firstWindow();
    await expect(page.locator("#service-status")).toHaveText("Connected");
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    await button("Settings").click();
    await page.getByLabel("Service", { exact: true }).selectOption("ado");
    await page.getByLabel("Collection or organisation URL").fill(collection);
    await page
      .getByLabel("Personal access token")
      .fill("DisposableFixtureCredential");
    await button("Save connection").click();
    await expect(button("Disconnect")).toBeVisible();
    saved = true;
    await page
      .getByRole("combobox", { name: "Product", exact: true })
      .selectOption({ label: "New product…" });
    await page.getByLabel("Product name").pressSequentially("Library");
    await button("Create product").click();
    await page.getByLabel("Source type").selectOption("repo");
    await page.getByLabel("Source title").fill("Library board");
    await page
      .getByLabel("Source reference")
      .fill(collection + "/Library/_git/demo");
    await button("Map source").click();
    await expect(
      page.getByRole("region", { name: "Product context" }),
    ).toContainText("Library board");

    await button("PRs").click();
    await page.getByLabel("PR number").fill("7");
    await button("Open pull request").click();
    await expect(
      page.getByRole("heading", { name: "Review a change" }),
    ).toBeVisible();
    await button("/README.md").click();
    await expect(page.locator(".monaco-diff-editor")).toBeVisible();
    await expect(page.getByLabel("File comparison")).toContainText("Edited");
    await expect(page.getByLabel("Diff summary")).toHaveText(
      "1 changed region",
    );
    await button("Prepare merge").click();
    await button("Approve merge").click();
    await expect(button("Execute approved merge")).toBeVisible();
    head = "b".repeat(40);
    await button("Execute approved merge").click();
    await expect(page.getByText(/The PR head or base changed/)).toBeVisible();
    expect(writes).toBe(0);
    const db = acceptanceDb(root);
    try {
      const { id: product } = db
        .prepare("SELECT id FROM products WHERE name='Library'")
        .get() as { id: string };
      db.prepare(
        "INSERT INTO work_items(id,product_id,type,title,status) VALUES('story',?,'story','Review example','published')",
      ).run(product);
      db.prepare(
        "INSERT INTO runs(id,product_id,story_id,agent_role,harness,state,started_at) VALUES('run',?,'story','Engineer','codex','completed','now')",
      ).run(product);
      db.prepare(
        "INSERT INTO delivery_pull_requests(run_id,repo,number,head) VALUES('run',?,7,?)",
      ).run(collection + "/Library/_git/demo", head);
      await button("Open pull request").click();
      await expect(
        page.getByText("Head " + head, { exact: false }).first(),
      ).toBeVisible();
      await button("Prepare merge").click();
      await button("Approve merge").click();
      await button("Execute approved merge").click();
      await expect(
        page.getByText("Merge verified.", { exact: true }),
      ).toBeVisible();
      expect(writes).toBe(1);
      expect(
        db.prepare("SELECT count(*) AS n FROM delivery_acceptance").get(),
      ).toEqual({ n: 0 });
      for (const v of [
        "Story status reviewed",
        "Merge verified",
        "Test evidence reviewed",
      ])
        await page.getByLabel(v, { exact: true }).check();
      for (const [decision, rationale] of [
        ["Blocked", "Customer validation pending"],
        ["Rejected", "The acceptance example needs revision"],
        ["Accepted", "The revised example passed review"],
      ] as const) {
        await page.getByLabel("Acceptance decision").selectOption(decision);
        await page.getByLabel("Acceptance rationale").fill(rationale);
        await button("Record delivery decision").click();
        await expect(
          page.getByText("Review example · " + decision + " · " + rationale),
        ).toBeVisible();
      }
      expect(
        db
          .prepare("SELECT verdict FROM delivery_acceptance ORDER BY rowid")
          .all(),
      ).toEqual(
        ["Blocked", "Rejected", "Accepted"].map((verdict) => ({ verdict })),
      );
      expect(writes).toBe(1);
    } finally {
      db.close();
    }
  } finally {
    if (saved && app) {
      const page = await app.firstWindow();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("button", { name: "Disconnect", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Disconnect", exact: true }),
      ).toHaveCount(0);
    }
    await app?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});
