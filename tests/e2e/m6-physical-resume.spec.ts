import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { openWorkspace } from "../../packages/data/src/workspace.ts";
import { Reminders } from "../../packages/data/src/reminders.ts";
import { launchMacWorkspace } from "../support/mac-workspace.ts";

test("real Mac sleep spans a reminder deadline and wake produces one review", async () => {
  test.skip(
    process.env.AMUN_T053_SLEEP_NOW !== "1" || process.platform !== "darwin",
    "Owner-coordinated physical sleep/wake",
  );
  test.setTimeout(10 * 60_000);
  const root = await mkdtemp(join(tmpdir(), "amun-physical-wake-"));
  const Database = createRequire(resolve("packages/data/package.json"))(
    "better-sqlite3",
  );
  const db = openWorkspace(join(root, "workspace"), Database);
  db.exec(
    `INSERT INTO products(id,name,created_at) VALUES('p','Atlas','now'); INSERT INTO workspace_settings VALUES('ui_preferences','{"productId":"p"}');`,
  );
  let app: Awaited<ReturnType<typeof launchMacWorkspace>> | undefined;
  try {
    app = await launchMacWorkspace(root);
    const page = await app.firstWindow();
    await expect(page.locator("#service-status")).toHaveText("Connected");
    const trace = await app.evaluateHandle(({ powerMonitor }) => {
      const events: { kind: string; at: number }[] = [];
      powerMonitor.once("suspend", () =>
        events.push({ kind: "suspend", at: Date.now() }),
      );
      powerMonitor.once("resume", () =>
        events.push({ kind: "resume", at: Date.now() }),
      );
      return events;
    });
    const deadline = Date.now() + 20_000;
    new Reminders(db).create(
      "p",
      "Physical wake fixture",
      "work",
      new Date(deadline).toISOString(),
      true,
    );
    if (process.env.AMUN_T053_APPLE_MENU === "1") {
      await promisify(execFile)("/usr/bin/osascript", [
        "-e",
        `tell application "System Events"
          set activeApp to first application process whose frontmost is true
          tell menu bar item 1 of menu bar 1 of activeApp
            click
            delay 0.25
            set sleepItem to menu item "Sleep" of menu 1
            if not enabled of sleepItem then error "Apple menu Sleep is disabled"
            click sleepItem
          end tell
        end tell`,
      ]);
    } else await promisify(execFile)("/usr/bin/pmset", ["sleepnow"]);
    await expect
      .poll(async () => (await trace.jsonValue()).map((e) => e.kind), {
        timeout: 9 * 60_000,
      })
      .toEqual(["suspend", "resume"]);
    const events = await trace.jsonValue();
    expect(events[0]!.at).toBeLessThan(deadline);
    expect(events[1]!.at).toBeGreaterThan(deadline);
    await page.getByRole("button", { name: "Notifications drawer" }).click();
    await expect(
      page.getByText("Missed reminder · Physical wake fixture", {
        exact: true,
      }),
    ).toHaveCount(1);
    expect(
      db.prepare("SELECT state FROM personal_tasks").pluck().all(),
    ).toEqual(["awaiting review"]);
    expect(
      db
        .prepare("SELECT count(*) FROM notifications WHERE kind='reminder_due'")
        .pluck()
        .get(),
    ).toBe(1);
    expect(db.prepare("SELECT count(*) FROM outbox").pluck().get()).toBe(0);
  } finally {
    await app?.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
