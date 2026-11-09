import { test, expect, type Locator } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { reach } from "../support/keyboard.ts";
import { launchMacWorkspace } from "../support/mac-workspace.ts";
import { acceptanceDb } from "../support/ado-acceptance-drafts.ts";

test("keyboard golden path creates a product, imports evidence, approves revision three and resolves the story decision", async () => {
  const port = process.env.AMUN_T054_MODEL_PORT;
  test.skip(
    !port,
    "Opt-in Mac acceptance with a loopback model and native file picker",
  );
  if (!/^\d+$/.test(port!)) throw Error("Expected numeric loopback port");
  test.setTimeout(480000);
  const root = await mkdtemp("/private/tmp/amun-m6-keyboard-");
  console.log("Disposable continuation profile", root);
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
          models: [{ id: "amun-local", contextWindow: 8192, maxTokens: 2048 }],
        },
      },
    }),
    { mode: 0o600 },
  );
  const docs = [
    ["Objective.md", "Let workspace admins invite teammates by email."],
    ["Expiry.md", "An invitation expires seven days after creation."],
    ["Access.md", "Only workspace admins may send or revoke invitations."],
  ] as const;
  const app = await launchMacWorkspace(root);
  try {
    const page = await app.firstWindow();
    const btn = (name: string) =>
      page.getByRole("button", { name, exact: true });
    const activate = async (l: Locator) => {
      await reach(page, l);
      await page.keyboard.press("Enter");
    };
    const enter = async (l: Locator, v: string) => {
      await reach(page, l);
      await page.keyboard.press("Meta+a");
      await page.keyboard.insertText(v);
    };
    await expect(page.locator("#service-status")).toHaveText("Connected");
    await reach(
      page,
      page.getByRole("combobox", { name: "Product", exact: true }),
    );
    await page.keyboard.press("n");
    await page.keyboard.press("Tab");
    await enter(page.getByLabel("Product name"), "Team onboarding");
    await enter(
      page.getByLabel("Allowed models (comma-separated IDs)"),
      "local/amun-local",
    );
    await activate(btn("Create product"));
    for (const [name, body] of docs) {
      const file = join(root, name);
      await writeFile(file, body, { mode: 0o600 });
      const input = page.getByLabel("Import document");
      await reach(page, input);
      await page.keyboard.press("Space");
      await promisify(execFile)("/usr/bin/osascript", [
        "-e",
        `tell application "System Events"
        tell (first application process whose unix id is ${app.process().pid})
          repeat 40 times
            if exists sheet 1 of window 1 then exit repeat
            delay 0.1
          end repeat
          if not (exists sheet 1 of window 1) then error "Native file sheet unavailable"
          if not frontmost then error "Test window lost focus"
          keystroke "g" using {command down, shift down}
          delay 0.3
          keystroke "${file}"
          key code 36
          delay 0.4
          key code 36
        end tell
      end tell`,
      ]);
      await expect(
        page.getByRole("listitem").filter({ hasText: name }),
      ).toHaveCount(1);
    }
    const projectURL = "https://devops.tahaluf.ae/TahalufCollection/ICV";
    await reach(page, page.getByLabel("Source type"));
    await page.keyboard.press("a");
    await page.keyboard.press("Tab");
    await enter(page.getByLabel("Source title"), "ICV");
    await enter(page.getByLabel("Source reference"), projectURL);
    await activate(btn("Map source"));
    await enter(page.getByLabel("Product objective"), docs[0][1]);
    await activate(btn("Start Firstmate interview"));
    await expect(page.getByTestId("requests-count")).toHaveText("1", {
      timeout: 145000,
    });
    await activate(
      page.getByTestId("tool-tile").filter({ hasText: "Requests" }),
    );
    await activate(page.locator(".request-list button").first());
    await enter(
      page.getByLabel("Your answer"),
      "Workspace admins invite teammates by email. Invitations expire after seven days.",
    );
    await activate(btn("Save answer"));
    await expect(page.getByTestId("requests-count")).toHaveText("0");
    await activate(btn("Close inspector"));
    await activate(btn("PRD"));
    await enter(page.getByLabel("Facts", { exact: true }), docs[0][1]);
    await enter(
      page.getByLabel("Assumptions", { exact: true }),
      "All invites belong to a single workspace.",
    );
    await enter(
      page.getByLabel("Open questions"),
      "Confirm invitation expiry.",
    );
    await activate(btn("Save understanding"));
    await activate(btn("Approve understanding"));
    await expect(page.getByText("Understanding v1 · Approved")).toBeVisible();
    await activate(page.getByRole("tab", { name: "Write", exact: true }));
    const editor = page.getByRole("textbox", {
      name: "PRD Markdown",
      exact: true,
    });
    const requirements = [
      "An invitation expires seven days after creation.",
      "Only workspace admins may send invitations.",
      "An admin can revoke an outstanding invitation.",
      "A recipient can accept an invitation exactly once.",
      "An admin can see the invitation status.",
      "Record each invitation change in the workspace audit log.",
    ];
    for (let i = 1; i <= 3; i++) {
      await enter(
        editor,
        "# Team onboarding\n\n" + requirements.slice(0, i * 2).join("\n\n"),
      );
      await expect(page.getByLabel("PRD approval status")).toContainText(
        "Draft PRD v" + i,
      );
    }
    await activate(page.getByRole("tab", { name: "Review", exact: true }));
    await activate(btn("Approve PRD v3"));
    await activate(btn("Generate stories"));
    await expect(page.getByText("Story drafts ready in Backlog.")).toBeVisible({
      timeout: 150000,
    });
    await activate(btn("Backlog"));
    const region = page.getByRole("region", { name: "Story drafts" });
    const list = region.getByRole("button", {
      name: "Ask Firstmate for decision options",
    });
    await activate(list.first());
    const decision = page
      .getByRole("region", { name: "Story decision" })
      .first();
    await expect(decision).toBeVisible({ timeout: 120000 });
    await activate(
      decision.getByRole("button", { name: "Save proposed answer" }),
    );
    await activate(
      decision.getByRole("button", { name: "Request confirmation" }),
    );
    await activate(
      decision.getByRole("button", { name: "Later", exact: true }),
    );
    await activate(btn("Decisions"));
    const blockers = page.getByRole("region", { name: "Story blockers" });
    await enter(
      blockers.getByLabel("Confirmation evidence"),
      "Verified against the synthetic seven-day invitation policy.",
    );
    await activate(blockers.getByRole("button", { name: "Resolve decision" }));
    await expect(blockers).toContainText("No outstanding story decisions.");
    const db = acceptanceDb(root);
    try {
      expect(
        db.prepare("SELECT count(*) FROM source_documents").pluck().get(),
      ).toBe(3);
      expect(
        db.prepare("SELECT count(*) FROM story_drafts").pluck().get(),
      ).toBeGreaterThanOrEqual(6);
    } finally {
      db.close();
    }
    await writeFile(join(root, "authoring-passed"), "v3\n", { mode: 0o600 });
  } finally {
    await app.close();
  }
});
