import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtemp,
  realpath,
  rm,
  readFile,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("stow measures a new real Firstmate home and records the empty sweep", async () => {
  test.setTimeout(90000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "amun-stow-")));
  const binary = process.env.AMUN_PACKAGED_PATH;
  const app = await electron.launch({
    ...(binary ? { executablePath: binary } : {}),
    args: [...(binary ? [] : ["apps/desktop"]), "--user-data-dir=" + root],
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("status")).toHaveText("Connected");
    for (const name of ["Open conversations", "Open Pi commands"])
      await page.getByRole("button", { name, exact: true }).click();
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("stow", { timeout: 2000 });
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    const result = page.getByTestId("native-pi-result");
    await expect(result).toContainText("Startup memory", { timeout: 60000 });
    const owner = (
      await readFile(join(root, "workspace/firstmate-crew-home"), "utf8")
    ).trim();
    const receipt = await readFile(
      join(root, "workspace", owner, "git/primary/data/stow-receipt.md"),
      "utf8",
    );
    expect(receipt).toContain("learnings.md");
    expect(receipt).toContain("within-budget");
    const data = join(root, "workspace", owner, "git/primary/data"),
      marker = "Disposable local memory fixture";
    await writeFile(join(data, "learnings.md"), marker);
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(result).toContainText("Local sweep finished", {
      timeout: 60000,
    });
    expect(await readFile(join(data, "learnings.md"), "utf8")).toBe(marker);
    expect(await readFile(join(data, "stow-receipt.md"), "utf8")).not.toContain(
      marker,
    );
    const worker = join(root, "workspace", owner, "git/codex-worker");
    await mkdir(join(worker, "data"), { recursive: true });
    await mkdir(join(worker, "config"), { recursive: true });
    await writeFile(join(worker, ".fm-secondmate-home"), "amun-codex\n");
    await writeFile(join(worker, "config/startup-memory-budget"), "7500\n");
    await writeFile(
      join(worker, "data/learnings.md"),
      "- Retired build convention <!--a:2020-01-01-->\n",
    );
    await writeFile(
      join(worker, "data/captain-shared.md"),
      "- Keep this shared rule.\n",
    );
    await writeFile(
      join(data, "secondmates.md"),
      "- amun-codex - local worker (home: " +
        worker +
        "; scope: tests; projects: none; added 2026-11-08)\n",
    );
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await expect(result).toContainText("Curated inactive worker", {
      timeout: 60000,
    });
    expect(
      await readFile(join(worker, "data/memory-archive.md"), "utf8"),
    ).toContain("Retired build convention");
    expect(await readFile(join(worker, "data/captain-shared.md"), "utf8")).toBe(
      "- Keep this shared rule.\n",
    );
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

test("local Stow learns a selected conversation and remembers each pin decision after reopening", async () => {
  test.skip(
    process.env.AMUN_LIVE_LOCAL_STOW !== "1",
    "Requires an installed GGUF and llama-completion",
  );
  test.setTimeout(360000);
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "amun-stow-curation-")),
  );
  const binary = process.env.AMUN_PACKAGED_PATH;
  const launch = () =>
    electron.launch({
      ...(binary ? { executablePath: binary } : {}),
      args: [...(binary ? [] : ["apps/desktop"]), "--user-data-dir=" + root],
    });
  let app = await launch(),
    page = await app.firstWindow();
  const controls = async () => {
    await expect(page.getByRole("status")).toHaveText("Connected");
    for (const name of ["Open conversations", "Open Pi commands"])
      await page.getByRole("button", { name, exact: true }).click();
  };
  const run = async (arg = "") => {
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("stow");
    await page.getByLabel("Command argument", { exact: true }).fill(arg);
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
  };
  try {
    await controls();
    await run();
    const result = () => page.getByTestId("native-pi-result");
    await expect(result()).toContainText("Startup memory", { timeout: 60000 });
    const owner = (
      await readFile(join(root, "workspace/firstmate-crew-home"), "utf8")
    ).trim();
    const data = join(root, "workspace", owner, "git/primary/data");
    const second = "I prefer meeting notes in Spanish.";
    const pref = "I prefer weekly reports on Fridays.",
      learning = "The test database must be reset before running smoke tests.";
    await writeFile(
      join(data, "captain.md"),
      "- I prefer weekly reports on Mondays.\n- I prefer meeting notes in French.\n",
    );
    const time = new Date().toISOString();
    const records = [
      {
        type: "session",
        version: 3,
        id: "32111111-1111-4111-8111-111111111111",
        timestamp: time,
        cwd: "/tmp/disposable-stow-source",
      },
      {
        type: "message",
        id: "ab123456",
        parentId: null,
        timestamp: time,
        message: {
          role: "user",
          content: [
            { type: "text", text: pref + "\n" + learning + "\n" + second },
          ],
          timestamp: Date.now(),
        },
      },
    ];
    await page
      .getByLabel("Import Pi session JSONL", { exact: false })
      .setInputFiles({
        name: "fixture.jsonl",
        mimeType: "application/jsonl",
        buffer: Buffer.from(
          records.map((r) => JSON.stringify(r)).join("\n") + "\n",
        ),
      });
    await page
      .getByRole("button", { name: "Confirm import into Amun", exact: true })
      .click();
    await expect(result()).toContainText("ID retained");
    await run();
    await expect(result()).toContainText("Review each pinned change", {
      timeout: 240000,
    });
    await expect(result()).toContainText(pref);
    expect(await readFile(join(data, "learnings.md"), "utf8")).toContain(
      learning,
    );
    expect(await readFile(join(data, "captain.md"), "utf8")).toContain(
      "Mondays",
    );
    await run();
    await expect(result()).toContainText("Already reviewed locally", {
      timeout: 60000,
    });
    await expect(
      page.getByRole("button", { name: "Apply this pinned change" }),
    ).toHaveCount(0);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await controls();
    await run("review");
    await expect(result()).toContainText(pref, { timeout: 60000 });
    await page
      .getByRole("group", { name: pref, exact: true })
      .getByRole("button", { name: "Apply this pinned change" })
      .click();
    await expect(result()).toContainText("applied the reviewed change", {
      timeout: 60000,
    });
    expect(await readFile(join(data, "captain.md"), "utf8")).toBe(
      "- " + pref + "\n- I prefer meeting notes in French.\n",
    );
    await run("review");
    await page
      .getByRole("group", { name: second, exact: true })
      .getByRole("button", { name: "Keep existing entry" })
      .click();
    await expect(result()).toContainText("Saved your decision to keep", {
      timeout: 60000,
    });
    expect(await readFile(join(data, "captain.md"), "utf8")).toContain(
      "French",
    );
    await run("review");
    await expect(result()).toContainText("No pinned changes await review", {
      timeout: 60000,
    });
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
