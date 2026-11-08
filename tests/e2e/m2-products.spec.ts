import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

test("two products keep mapped sources, models and persisted source-backed memory isolated", async () => {
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), "amun-m2-products-"));
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
  let app = await launch();
  try {
    let page = await app.firstWindow();
    for (const name of ["Atlas", "Beacon"]) {
      await page
        .getByRole("combobox", { name: "Product", exact: true })
        .selectOption({ label: "New product…" });
      await page.getByLabel("Product name").pressSequentially(name);
      await expect(page.getByLabel("Product name")).toHaveValue(name);
      await page
        .getByLabel("Allowed models (comma-separated IDs)")
        .fill(name + "-model");
      await page.getByRole("button", { name: "Create product" }).click();
      await page.getByLabel("Source title").fill(name + " brief");
      await page.getByLabel("Source reference").fill("docs/" + name + ".md");
      await page.getByRole("button", { name: "Map source" }).click();
      await expect(
        page.getByRole("region", { name: "Product context" }),
      ).toContainText(name + " brief");
      await page
        .getByLabel("Product decision")
        .pressSequentially(name + " decision");
      await page.getByRole("button", { name: "Pin decision" }).click();
      await expect(
        page.getByRole("region", { name: "Product context" }),
      ).toContainText(name + " decision");
    }
    await app.close();
    const Database = createRequire(resolve("packages/data/package.json"))(
      "better-sqlite3",
    );
    const db = new Database(join(root, "workspace/workspace.sqlite"));
    try {
      db.exec(
        "INSERT INTO memory_entities (id,product_id,type,data_json,source_id,updated_at) SELECT s.id,s.product_id,'fact',json_object('text',p.name || ' memory'),s.id,'now' FROM sources s JOIN products p ON p.id=s.product_id",
      );
    } finally {
      db.close();
    }
    app = await launch();
    page = await app.firstWindow();
    for (const [name, other] of [
      ["Atlas", "Beacon"],
      ["Beacon", "Atlas"],
    ] as const) {
      await page
        .getByRole("combobox", { name: "Product", exact: true })
        .selectOption({ label: name });
      const context = page.getByRole("region", { name: "Product context" });
      for (const suffix of [" brief", "-model", " memory", " decision"])
        await expect(context).toContainText(name + suffix);
      await expect(context).not.toContainText(other);
    }
    await page
      .getByRole("combobox", { name: "Product", exact: true })
      .selectOption({ label: "Portfolio" });
    await expect(
      page.getByRole("region", { name: "Product context" }),
    ).toHaveCount(0);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a fresh product cannot inherit the other product's active native conversation", async () => {
  test.setTimeout(150000);
  const root = await mkdtemp(join(tmpdir(), "amun-m2-native-scope-"));
  const app = await electron.launch({
    args: [
      ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
      "--user-data-dir=" + root,
    ],
    ...(process.env.AMUN_PACKAGED_PATH
      ? { executablePath: process.env.AMUN_PACKAGED_PATH }
      : {}),
  });
  try {
    const page = await app.firstWindow();
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    for (const name of ["Atlas", "Beacon"]) {
      await page
        .getByRole("combobox", { name: "Product", exact: true })
        .selectOption({ label: "New product…" });
      await page.getByLabel("Product name").pressSequentially(name);
      await expect(page.getByLabel("Product name")).toHaveValue(name);
      await button("Create product").click();
      await expect(
        page.getByRole("region", { name: "Product context" }),
      ).toBeVisible();
      await button("Open conversations").click();
      await button("Open Pi commands").click();
      await page
        .getByLabel("Native Pi command", { exact: true })
        .selectOption("name");
      await page.getByLabel("Command argument", { exact: true }).fill("");
      if (name === "Atlas")
        await page
          .getByLabel("Command argument", { exact: true })
          .pressSequentially("Atlas private session");
      await expect(
        page.getByLabel("Command argument", { exact: true }),
      ).toHaveValue(name === "Atlas" ? "Atlas private session" : "");
      await button("Run command").click();
      await expect(page.getByTestId("native-pi-result")).toContainText(
        name === "Atlas" ? "Atlas private session" : "Unnamed session",
        { timeout: 60000 },
      );
    }
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
