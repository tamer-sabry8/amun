import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
test("imports the six supported formats and rejects an unsupported file in the Mac app", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-m2-ingest-"));
  const args = process.env.AMUN_PACKAGED_PATH
    ? {
        executablePath: process.env.AMUN_PACKAGED_PATH,
        args: ["--user-data-dir=" + root],
      }
    : { args: ["apps/desktop", "--user-data-dir=" + root] };
  const app = await electron.launch(args);
  try {
    const page = await app.firstWindow();
    await expect(page.locator("#service-status")).toHaveText("Connected");
    await page
      .getByRole("combobox", { name: "Product", exact: true })
      .selectOption({ label: "New product…" });
    await page.getByLabel("Product name").pressSequentially("Amun");
    await page.getByRole("button", { name: "Create product" }).click();
    const ref = join(root, "Objective.txt");
    await writeFile(ref, "Map source evidence to approved requirements.");
    await writeFile(
      join(root, "Objective.md"),
      "# Objective\nMap source evidence to approved requirements.",
    );
    execFileSync("/usr/bin/textutil", [
      "-convert",
      "docx",
      "-output",
      join(root, "Objective.docx"),
      ref,
    ]);
    await writeFile(
      join(root, "Objective.pdf"),
      execFileSync("/usr/sbin/cupsfilter", ["-m", "application/pdf", ref], {
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    const png = resolve(
      "tests/e2e/m1-gallery.spec.ts-snapshots/gallery-navy-gold-card-darwin.png",
    );
    execFileSync(
      "/usr/bin/sips",
      ["-Z", "160", png, "--out", join(root, "Objective.png")],
      { stdio: "pipe" },
    );
    execFileSync(
      "/usr/bin/sips",
      [
        "-s",
        "format",
        "jpeg",
        join(root, "Objective.png"),
        "--out",
        join(root, "Objective.jpg"),
      ],
      { stdio: "pipe" },
    );
    const picker = page.getByLabel("Import document");
    for (const ext of ["txt", "md", "pdf", "docx", "png", "jpg"]) {
      const name = "Objective." + ext;
      await picker.setInputFiles(join(root, name));
      await expect(
        page
          .getByRole("region", { name: "Product context" })
          .getByRole("listitem")
          .filter({ hasText: name }),
      ).toHaveCount(1, { timeout: 20000 });
    }
    await picker.setInputFiles({
      name: "unsupported.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("zip"),
    });
    await expect(page.getByRole("alert")).toContainText("Choose TXT");
    const Database = createRequire(resolve("packages/data/package.json"))(
      "better-sqlite3",
    );
    const db = new Database(join(root, "workspace/workspace.sqlite"), {
      readonly: true,
    });
    try {
      const rows = db
        .prepare(
          "SELECT kind,body,hash,length(image) AS imageSize FROM sources JOIN source_documents ON sources.id=source_documents.source_id",
        )
        .all() as {
        kind: string;
        body: string;
        hash: string;
        imageSize: number | null;
      }[];
      expect(rows).toHaveLength(6);
      for (const row of rows) {
        expect(row.hash).toMatch(/^[a-f0-9]{64}$/);
        if (["png", "jpeg"].includes(row.kind))
          expect(row.imageSize).toBeGreaterThan(0);
        else expect(row.body).toContain("Map source evidence");
      }
    } finally {
      db.close();
    }
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
