import { test, expect, _electron as electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { reach } from "../support/keyboard.ts";
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
  expect(
    files.every((f: { filename: string }) =>
      f.filename.startsWith("TEST-invitation-fixture/"),
    ),
  ).toBe(true);
  test.setTimeout(480000);
  const root = process.env.AMUN_T054_PROFILE!;
  if (root !== "/private/tmp/amun-m6-keyboard-aIPB0w")
    throw Error("Unexpected profile");
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
    const activate = async (control: import("@playwright/test").Locator) => {
      await reach(page, control);
      await page.keyboard.press("Enter");
    };

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
      const token = gh(["auth", "token", "--hostname", "github.com"]);
      const existing = await entry.getPassword();
      if (existing && existing !== token)
        throw Error("Unexpected existing acceptance credential");
      if (!existing) await entry.setPassword(token);
      if (!process.env.AMUN_T054_KEEP_CREDENTIAL)
        erase = () => entry.deletePassword();
      db.prepare(
        "INSERT OR REPLACE INTO workspace_settings(id,value_json) VALUES('connections',?)",
      ).run(JSON.stringify([conn]));
    } finally {
      db.close();
    }
    if (process.env.AMUN_T054_LINK_PR) {
      await activate(button("Overview"));
      const request = page.getByRole("button", {
        name: /^Please configure or identify the approved restricted worker identity/,
      });
      if (await request.count()) {
        await activate(request);
        const answer = page.getByLabel("Your answer");
        await reach(page, answer);
        await page.keyboard.insertText(
          "The owner approved captain-account TEST publication and continuation for Firstmate and secondmates. The captain published the independently verified fixture and opened TEST PR #9 against its isolated TEST base. Continue this delivery using that existing PR. Preserve the same worker and worktree.",
        );
        await activate(button("Save answer"));
        await activate(button("Close inspector"));
      }
      const report = join(
        root,
        "workspace",
        "delivery",
        "dfdc1c4a-5c34-4ecd-a8c1-fcf1e71a4217",
        "report.json",
      );
      const previous = await readFile(report, "utf8");
      if (JSON.parse(previous).state === "blocked")
        await writeFile(join(root, "worker-blocked-report.json"), previous, {
          mode: 0o600,
        });
      // Captain publication is independently verified above; the production refresh checks its head again.
      await writeFile(
        report,
        JSON.stringify({
          state: "pull_request",
          number,
          head,
          tests:
            "Independent Mac fixture tests passed 3/3; captain published the owner-approved TEST PR.",
        }),
        { mode: 0o600 },
      );
      await activate(button("Backlog"));
      const story = page.getByRole("article").filter({
        has: page.getByRole("heading", {
          name: "Revoke Invitation",
          exact: true,
        }),
      });
      await activate(
        story.getByRole("button", {
          name: "Ask Firstmate to implement",
          exact: true,
        }),
      );
      await activate(
        story.getByRole("button", {
          name: "Check worker report and resume",
          exact: true,
        }),
      );
      await expect(story.getByRole("status")).toHaveText(/Verified PR #9/, {
        timeout: 300000,
      });
    }
    if (process.env.AMUN_T054_PR_STAGE === "link") return;
    await activate(button("PRs"));
    await expect(page.locator("select[name=source] option")).toHaveText(
      "TEST implementation repository",
    );
    await activate(button("Load repository PRs"));
    await expect(
      page
        .getByRole("region", { name: "Pull request workspace" })
        .getByRole("status"),
    ).toHaveText(/^[1-9][0-9]* open pull requests/, { timeout: 60000 });
    await activate(
      page.getByRole("button", {
        name: new RegExp("TEST implementation repository #" + number),
      }),
    );
    await expect(
      page.getByRole("heading", { name: initial.title }),
    ).toBeVisible();
    if (process.env.AMUN_T054_PR_STAGE === "reject") {
      const prior = JSON.parse(
        await readFile(join(root, "merge-approved.json"), "utf8"),
      );
      const exact = page.getByRole("region", { name: "Exact merge review" });
      await expect(exact).toContainText(prior.head);
      expect(head).not.toBe(prior.head);
      await activate(button("Execute approved merge"));
      await expect(
        page
          .getByRole("region", { name: "Pull request workspace" })
          .getByRole("status"),
      ).toHaveText("The PR head or base changed. Review the new version.", {
        timeout: 30000,
      });
      const state = acceptanceDb(root);
      try {
        expect(
          state
            .prepare(
              "SELECT state FROM actions WHERE kind='merge' ORDER BY rowid DESC LIMIT 1",
            )
            .pluck()
            .get(),
        ).toBe("invalidated");
      } finally {
        state.close();
      }
      const remote = read();
      expect(remote.merged).toBe(false);
      expect(remote.head.sha).toBe(head);
      await writeFile(
        join(root, "stale-merge-refused.json"),
        JSON.stringify({
          number,
          approvedHead: prior.head,
          refusedHead: head,
          verified: true,
        }),
        { mode: 0o600 },
      );
      return;
    }
    await activate(button("TEST-invitation-fixture/invitations.mjs"));
    await expect(page.getByLabel("Diff summary")).toHaveText(/changed region/);
    await reach(page, page.getByLabel("Merge method"));
    await page.keyboard.press("m");
    await page.keyboard.press("Tab");
    await activate(button("Prepare merge"));
    const preview = page.getByRole("region", { name: "Exact merge review" });
    await expect(preview).toContainText(head!);
    await expect(preview).toContainText(base!);
    await expect(preview).toContainText("https://github.com/" + lookup);
    await activate(button("Approve merge"));
    await expect(button("Execute approved merge")).toBeVisible();
    if (process.env.AMUN_T054_PR_STAGE === "prepare") {
      await writeFile(
        join(root, "merge-approved.json"),
        JSON.stringify({ number, head, base }),
        { mode: 0o600 },
      );
      return;
    }
    await activate(button("Execute approved merge"));
    await expect(
      page.getByText("Merge verified.", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    const final = read();
    expect(final.merged).toBe(true);
    expect(final.head.sha).toBe(head);
    expect(final.base.ref).toBe(base);
    await expect(page.getByLabel("Delivery story")).toContainText(
      "Revoke Invitation",
    );
    const checks = preview.getByRole("checkbox");
    for (const check of await checks.all()) {
      await reach(page, check);
      await page.keyboard.press("Space");
    }
    await reach(page, page.getByLabel("Acceptance rationale"));
    await page.keyboard.insertText(
      "Synthetic fixture passed all three Mac HTTP tests, live PR head-change protection and verified TEST merge.",
    );
    await activate(button("Record delivery decision"));
    await expect(
      page.getByText("Acceptance recorded.", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    const evidence = acceptanceDb(root);
    try {
      expect(
        evidence
          .prepare(
            "SELECT verdict FROM delivery_acceptance ORDER BY rowid DESC LIMIT 1",
          )
          .pluck()
          .get(),
      ).toBe("Accepted");
    } finally {
      evidence.close();
    }
  } finally {
    try {
      await app.close();
    } finally {
      await erase?.();
    }
  }
});
