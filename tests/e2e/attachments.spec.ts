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

// Composer attachments in the development app, disposable profile, no
// connections: a file read in full shows nothing extra, a large file and an
// unreadable file each get the plain card above the prompt box, and every
// file is filed in the work area's library.
const shots = process.env.AMUN_REBUILD_SHOTS;

test("files are read, problems are explained in a card, and all are filed", async () => {
  test.setTimeout(120_000);
  const root = await mkdtemp(join(tmpdir(), "amun-attachments-"));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await mkdir(join(root, "workspace"), { mode: 0o700 });
    const file = join(root, "workspace", "workspace.sqlite");
    const db = new Database(file);
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
      tools: [],
      agents: [],
      groups: [{ name: "Employer", routes: [] }],
    });
    send("create-area", {
      groupId: store.snapshot().groups[0]!.id,
      type: "product",
      name: "Pilot",
    });
    db.close();
    await chmod(file, 0o600);

    app = await electron.launch({
      args: ["apps/desktop", "--user-data-dir=" + root],
      chromiumSandbox: true,
      env: {
        ...(process.env as Record<string, string>),
        AMUN_LEGACY_SHELL: "0",
      },
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1360, height: 860 });
    await page.getByRole("button", { name: /Pilot/ }).first().click();
    const convo = page.getByRole("region", { name: "Conversation" });
    await expect(convo).toBeVisible({ timeout: 30_000 });
    const picker = page.locator('input[type="file"]');

    // Read in full: the name appears as today and no card is shown.
    await picker.setInputFiles({
      name: "pilot-plan.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Pilot\nTen testers in Dubai."),
    });
    await expect(convo.getByText("pilot-plan.md")).toBeVisible();
    await expect(
      convo.getByText(/I could only read|I couldn’t open/),
    ).toHaveCount(0);

    // A large file: only part is read, said plainly, with two buttons.
    await picker.setInputFiles({
      name: "testers.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("name,city\n" + "Amal,Dubai\n".repeat(36_000)),
    });
    await expect(
      convo.getByText(
        /I could only read the first part of testers\.csv, about a quarter of it\./,
      ),
    ).toBeVisible({ timeout: 20_000 });
    if (shots) {
      await mkdir(shots, { recursive: true });
      await page.screenshot({
        path: join(shots, "attachment-partly-read.png"),
      });
    }
    await convo.getByRole("button", { name: "Use what was read" }).click();
    await expect(convo.getByText(/I could only read/)).toHaveCount(0);
    await expect(convo.getByText("testers.csv")).toBeVisible();

    // A file that cannot be opened: card, then removed from the draft.
    await picker.setInputFiles({
      name: "model.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.from([0, 1, 2, 255, 254, 0, 9, 0, 0, 7]),
    });
    await expect(
      convo.getByText(
        /I couldn’t open model\.bin\. It’s saved in your library\./,
      ),
    ).toBeVisible({ timeout: 20_000 });
    if (shots)
      await page.screenshot({ path: join(shots, "attachment-not-read.png") });
    await convo.getByRole("button", { name: "Remove the file" }).click();
    await expect(convo.getByText("model.bin")).toHaveCount(0);

    // Sending carries the files; with no provider the message waits.
    await page.getByLabel("Message Firstmate").fill("Who is in the pilot?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(convo.getByText("Who is in the pilot?")).toBeVisible();
    await expect(convo.getByText("Waiting to send")).toBeVisible({
      timeout: 30_000,
    });

    // Every attachment was filed in this work area's library, read or not.
    const check = new Database(file, { readonly: true });
    const filed = check
      .prepare(
        "SELECT r.title FROM work_records r JOIN work_record_links l ON l.record_id=r.id ORDER BY r.title",
      )
      .all()
      .map((row: { title: string }) => row.title);
    check.close();
    expect(filed).toEqual(["model.bin", "pilot-plan.md", "testers.csv"]);
  } finally {
    await app?.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
});
