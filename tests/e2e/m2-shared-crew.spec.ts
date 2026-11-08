import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("one verified crew home keeps the same operational note across two products and excludes their private conversation text", async () => {
  test.skip(
    process.env.AMUN_LIVE_LOCAL_STOW !== "1",
    "Requires the installed local GGUF.",
  );
  test.setTimeout(360000);
  const root = await mkdtemp(join(tmpdir(), "amun-m2-shared-crew-"));
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
    const page = await app.firstWindow(),
      button = (name: string) =>
        page.getByRole("button", { name, exact: true });
    await expect(page.locator("#service-status")).toHaveText("Connected");
    let firstHome = "";
    const note = "I prefer weekly reports on Fridays.";
    const pointer = join(root, "workspace/firstmate-crew-home");
    for (const product of ["Atlas", "Beacon"]) {
      await page
        .getByRole("combobox", { name: "Product", exact: true })
        .selectOption({ label: "New product…" });
      await page.getByLabel("Product name").pressSequentially(product);
      await button("Create product").click();
      await expect(
        page.getByRole("region", { name: "Product context" }),
      ).toBeVisible();
      await button("Open conversations").click();
      await button("Open Pi commands").click();
      const privateFact = product + " private launch date is November 17.";
      const time = new Date().toISOString();
      const records = [
        {
          type: "session",
          version: 3,
          id: randomUUID(),
          timestamp: time,
          cwd: root,
        },
        {
          type: "message",
          id: "ab123456",
          parentId: null,
          timestamp: time,
          message: {
            role: "user",
            content: [{ type: "text", text: privateFact }],
            timestamp: Date.now(),
          },
        },
      ];
      await page.getByLabel("Import Pi session JSONL").setInputFiles({
        name: "fixture.jsonl",
        mimeType: "application/jsonl",
        buffer: Buffer.from(
          records.map((r) => JSON.stringify(r)).join("\n") + "\n",
        ),
      });
      await button("Confirm import into Amun").click();
      const result = page.getByTestId("native-pi-result");
      await expect(result).toContainText("ID retained", { timeout: 30000 });
      const run = async (arg: string) => {
        await page
          .getByLabel("Native Pi command", { exact: true })
          .selectOption("stow");
        await page.getByLabel("Command argument", { exact: true }).fill(arg);
        await button("Run command").click();
        await expect(result).toContainText("Startup memory", {
          timeout: 240000,
        });
      };
      if (product === "Atlas") await run("shared " + note);
      await run("");
      const home = (await readFile(pointer, "utf8")).trim();
      if (firstHome) expect(home).toBe(firstHome);
      else firstHome = home;
      const data = join(root, "workspace", home, "git/primary/data");
      const memory = (
        await Promise.all(
          (await readdir(data))
            .filter((file) => file.endsWith(".md"))
            .map((file) => readFile(join(data, file), "utf8")),
        )
      ).join("\n");
      expect(memory).toContain(note);
      expect(memory).not.toContain("private launch date");
    }
  } finally {
    await app.close();
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
});
