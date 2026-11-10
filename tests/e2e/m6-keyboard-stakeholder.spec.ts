import { test, expect, type Locator } from "@playwright/test";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { launchMacWorkspace } from "../support/mac-workspace.ts";
import { reach } from "../support/keyboard.ts";
import { acceptanceDb } from "../support/ado-acceptance-drafts.ts";
import { readNotionReceipt } from "../../packages/data/src/notion-receipt.ts";

test("keyboard journey prepares the exact synthetic delivery update for owner review", async () => {
  const root = process.env.AMUN_T054_PROFILE;
  test.skip(
    !process.env.AMUN_T054_STAKEHOLDER,
    "Live final stakeholder acceptance.",
  );
  if (root !== "/private/tmp/amun-m6-keyboard-aIPB0w")
    throw Error("Unexpected profile");
  test.setTimeout(720000);
  const destination = JSON.parse(
    await readFile(join(root, "notion-destination-verified.json"), "utf8"),
  );
  expect(destination.verified).toBe(true);
  const db = acceptanceDb(root);
  const accepted = db
    .prepare(
      "SELECT a.id,a.story_id,p.head,p.number FROM delivery_acceptance a JOIN runs r ON r.story_id=a.story_id JOIN delivery_pull_requests p ON p.run_id=r.id WHERE a.verdict='Accepted' AND p.number=9 ORDER BY a.rowid DESC LIMIT 1",
    )
    .get() as { id: string; story_id: string; head: string; number: number };
  expect(accepted).toBeTruthy();
  expect(accepted.head).toBe("a09e32ab6b4ef85c595bff7a705cc61ca455f59d");
  const title = "Amun T054 stakeholder update (synthetic)";
  const text = [
    "Synthetic acceptance fixture.",
    "",
    "Revoke Invitation — Accepted [work item: " +
      accepted.story_id +
      "] [acceptance: " +
      accepted.id +
      "]",
    "GitHub TEST PR #9 — merge verified at source commit " +
      accepted.head +
      ".",
    "https://github.com/tamer-sabry8/amun/pull/9",
    "",
    "The six Azure test items were deleted after publication and sprint verification.",
    "Other synthetic stories — no acceptance verdict recorded.",
  ].join("\n");
  const app = await launchMacWorkspace(root);
  try {
    const page = await app.firstWindow();
    await expect(page.locator("#service-status")).toHaveText("Connected");
    const activate = async (control: Locator) => {
      await expect(control).toBeEnabled();
      await reach(page, control);
      await page.keyboard.press("Enter");
    };
    const enter = async (control: Locator, value: string) => {
      await reach(page, control);
      await page.keyboard.press("Meta+a");
      await page.keyboard.insertText(value);
    };
    await activate(page.getByRole("button", { name: "Overview", exact: true }));
    const context = page.getByRole("region", { name: "Product context" });
    const update = context.locator("details").filter({
      has: page.locator("summary").filter({ hasText: /^Stakeholder update$/ }),
    });
    await activate(update.locator("summary"));
    const approvedBinding = process.env.AMUN_T054_APPROVED_BINDING;
    if (approvedBinding) {
      expect(approvedBinding).toBe(
        "8c003af9c7fdb653a0d8fc6e2beb2d71a7d2b98a85baa5a9630434fd36801645",
      );
      await activate(
        update.getByRole("button", {
          name: "Resume last Notion review",
          exact: true,
        }),
      );
    } else {
      await activate(
        update.getByRole("button", {
          name: "Draft from source records",
          exact: true,
        }),
      );
      await expect(update.getByLabel("Update content")).toHaveValue(
        /Revoke Invitation — Accepted/,
      );
      await enter(update.getByLabel("Update title"), title);
      await enter(update.getByLabel("Update content"), text);
      await reach(page, update.getByLabel("Share via"));
      await page.keyboard.press("n");
      await page.keyboard.press("Tab");
      await activate(
        update.getByRole("button", {
          name: "Review exact content and destination",
          exact: true,
        }),
      );
    }
    await expect(
      update.getByRole("button", {
        name: "Approve exact Notion publication",
        exact: true,
      }),
    ).toBeVisible({ timeout: 60000 });
    const held = db
      .prepare(
        "SELECT id,payload_hash AS binding,payload_json AS payload,state FROM actions WHERE kind='notion_publish' ORDER BY rowid DESC LIMIT 1",
      )
      .get() as { id: string; binding: string; payload: string; state: string };
    const payload = JSON.parse(held.payload);
    expect(held.state).toBe("pending_approval");
    expect(payload.title).toBe(title);
    expect(payload.text.startsWith(text)).toBe(true);
    await expect(update.locator("pre")).toHaveText(payload.text);
    await expect(update).toContainText("Document Hub");
    await writeFile(
      join(root, "stakeholder-review.json"),
      JSON.stringify(
        { id: held.id, binding: held.binding, ...payload },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    if (approvedBinding) {
      expect(held.binding).toBe(approvedBinding);
      expect(held.id).toBe("2e581d75-bec8-4f0c-b69a-58c08438efbf");
      await activate(
        update.getByRole("button", {
          name: "Approve exact Notion publication",
          exact: true,
        }),
      );
    }
    await expect(update.getByRole("status")).toHaveText(
      "Published to Notion.",
      { timeout: 600000 },
    );
    expect(
      db.prepare("SELECT state FROM actions WHERE id=?").pluck().get(held.id),
    ).toBe("succeeded");
    expect(
      db
        .prepare("SELECT attempt FROM outbox WHERE action_id=?")
        .pluck()
        .get(held.id),
    ).toBe(1);
    const receipt = readNotionReceipt(db, held.id);
    expect(receipt).toBeTruthy();
    await writeFile(
      join(root, "stakeholder-verified.json"),
      JSON.stringify({ id: held.id, binding: held.binding, receipt }, null, 2),
      { mode: 0o600 },
    );
  } finally {
    await app.close();
    db.close();
  }
});
