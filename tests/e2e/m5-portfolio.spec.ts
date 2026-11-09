import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { openWorkspace } from "../../packages/data/src/workspace.ts";

test("portfolio shows two products, their blockers and decisions, and retains confirmation after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "amun-m5-portfolio-"));
  const launch = () =>
    electron.launch({
      args: [
        ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
        "--user-data-dir=" + root,
      ],
      ...(process.env.AMUN_PACKAGED_PATH
        ? { executablePath: process.env.AMUN_PACKAGED_PATH }
        : {}),
    });
  let app;
  try {
    const Database = createRequire(resolve("packages/data/package.json"))(
      "better-sqlite3",
    );
    const db = openWorkspace(join(root, "workspace"), Database);
    try {
      for (const [name, status] of [
        ["Atlas", "draft"],
        ["Beacon", "committed"],
      ] as const) {
        db.prepare(
          "INSERT INTO products(id,name,created_at) VALUES(?,?,'now')",
        ).run(name, name);
        db.prepare(
          "INSERT INTO sources(id,product_id,kind,title,external_id,retrieved_at,hash) VALUES(?,?,'repo','Shared platform','example/platform','now','test')",
        ).run(name, name);
        db.prepare(
          "INSERT INTO work_items(id,product_id,title,status,type) VALUES(?,?,?,?, 'story')",
        ).run(name, name, name + " story", status);
        db.prepare(
          "INSERT INTO work_items(id,product_id,title,status,type) VALUES(?,?,?,'blocked','story')",
        ).run(name + "-blocked", name, name + " integration");
        db.prepare(
          "INSERT INTO attention_items(id,product_id,type,origin_kind,origin_label,ask,detail,blocking_refs,primary_action_json,governed,state,created_at) VALUES(?,?,'decide','firstmate','Firstmate',?,'','[]',?,0,'open',?)",
        ).run(
          name,
          name,
          name + " release decision",
          JSON.stringify({
            label: "Review",
            mode: "navigate",
            intent: "open_request",
            targetRef: name,
          }),
          new Date().toISOString(),
        );
      }
    } finally {
      db.close();
    }
    app = await launch();
    let page = await app.firstWindow();
    const overview = page.getByRole("region", { name: "Portfolio overview" });
    for (const [name, status] of [
      ["Atlas", "draft"],
      ["Beacon", "committed"],
    ] as const) {
      const card = overview
        .getByRole("article")
        .filter({ has: page.getByRole("heading", { name, exact: true }) });
      for (const detail of [
        "1 " + status,
        name + " integration",
        name + " release decision",
      ])
        await expect(card).toContainText(detail);
    }
    await expect(overview).toContainText("Inferred (unconfirmed)");
    await overview.getByRole("button", { name: "Confirm dependency" }).click();
    await expect(overview).toContainText("Confirmed");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(
      page.getByRole("region", { name: "Portfolio overview" }),
    ).toContainText("Confirmed");
    await page
      .getByRole("combobox", { name: "Product", exact: true })
      .selectOption("Atlas");
    await expect(
      page.getByRole("region", { name: "Portfolio overview" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Product context" }),
    ).not.toContainText("Beacon");
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
