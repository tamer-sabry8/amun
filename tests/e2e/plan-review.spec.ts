import { test, expect, _electron as electron } from "@playwright/test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "../../packages/data/src/database.ts";
import { WorkStore } from "../../packages/data/src/work-store.ts";

const Database = createRequire(resolve("packages/data/package.json"))(
  "better-sqlite3",
);

// Plan review in the development app, in a disposable profile with no
// connections: per-item destinations, approving only one item, and what the
// review shows when the destination cannot be written to. Nothing external
// is contacted.
const shots = process.env.AMUN_REBUILD_SHOTS;
const launch = (root: string) =>
  electron.launch({
    args: [
      ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
      "--user-data-dir=" + root,
    ],
    ...(process.env.AMUN_PACKAGED_PATH
      ? { executablePath: process.env.AMUN_PACKAGED_PATH }
      : {}),
    chromiumSandbox: true,
    env: { ...(process.env as Record<string, string>), AMUN_LEGACY_SHELL: "0" },
  });

test("approve one of two items; the other waits; a blocked write offers Retry", async () => {
  test.setTimeout(120_000);
  const root = await mkdtemp(join(tmpdir(), "amun-plan-review-"));
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    await mkdir(join(root, "workspace"), { mode: 0o700 });
    // Seed through the same store the service uses: setup, one product, and
    // a proposed plan with a story for Azure DevOps and a page for Notion.
    const db = new Database(join(root, "workspace", "workspace.sqlite"));
    migrate(db);
    const store = new WorkStore(db);
    const send = (action: string, extra: Record<string, unknown>) => {
      const result = store
        .handle({ version: 1, kind: "work", action, ...extra })
        .find((event) => event.kind === "work-result");
      if (!result?.ok) throw Error(action + ": " + result?.message);
      return result.ref;
    };
    send("finish-setup", {
      workTypes: ["product"],
      tools: ["ado", "notion"],
      agents: [],
      groups: [{ name: "Employer", routes: [] }],
    });
    const groupId = store.snapshot().groups[0]!.id;
    const areaId = send("create-area", {
      groupId,
      type: "product",
      name: "Pilot",
    });
    send("propose-plan", {
      groupId: null,
      workAreaId: areaId,
      planKind: "stories",
      destination: "ado",
      summary: "Pilot sample: one story and one page",
      items: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          summary: "Invite the first 10 Dubai testers",
          fields: { description: "Send invitations and confirm devices." },
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          summary: "Pilot plan summary",
          fields: { destination: "notion", body: "Ten testers in Dubai." },
        },
      ],
    });
    db.close();
    // The service refuses a workspace that others could read.
    await chmod(join(root, "workspace", "workspace.sqlite"), 0o600);

    app = await launch(root);
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1360, height: 860 });
    await page
      .getByRole("region", { name: /attention/i })
      .getByRole("button", { name: "Review changes" })
      .click();
    // Home's small tray names every destination, not just the first.
    await expect(
      page.getByText("To 2 destinations · nothing is published until"),
    ).toBeVisible({ timeout: 30_000 });
    // The full review opens from the Island.
    await page
      .getByRole("navigation", { name: "Amun" })
      .getByRole("button", { name: "Review changes" })
      .click();
    const review = page.getByRole("region", { name: "Review" });
    await expect(review.getByText("To 2 destinations · 2 items")).toBeVisible();
    await expect(
      review.getByText("Azure DevOps", { exact: true }),
    ).toBeVisible();
    await expect(review.getByText("Notion", { exact: true })).toBeVisible();
    await expect(
      review.getByText("No Azure DevOps project is chosen for this work yet."),
    ).toBeVisible();
    await expect(
      review.getByRole("button", { name: "Approve and publish 2 stories" }),
    ).toBeVisible();

    // Untick the Notion page: only the story is approved.
    await review.getByRole("checkbox").nth(1).uncheck();
    if (shots) {
      await mkdir(shots, { recursive: true });
      await page.screenshot({ path: join(shots, "plan-review-ticks.png") });
    }
    await review
      .getByRole("button", { name: "Approve and publish 1 of 2" })
      .click();

    // The unticked item is still waiting, not approved and not sent.
    await expect(review.getByText("Not approved yet")).toBeVisible();
    await expect(
      review.getByRole("button", { name: "Remove from plan" }),
    ).toBeVisible();
    // No project is mapped in this profile, so nothing was sent and the
    // review says so with a way to try again.
    await expect(review.getByText("Not created")).toBeVisible({
      timeout: 20_000,
    });
    await expect(review.getByRole("button", { name: "Retry" })).toBeVisible();
    if (shots)
      await page.screenshot({ path: join(shots, "plan-review-after.png") });

    const check = new Database(join(root, "workspace", "workspace.sqlite"), {
      readonly: true,
    });
    const writes = check
      .prepare("SELECT destination,state,attempts FROM plan_writes")
      .all();
    check.close();
    // Exactly the approved item, never sent.
    expect(writes).toEqual([
      { destination: "ado", state: "pending", attempts: 0 },
    ]);
  } finally {
    await app?.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
});
