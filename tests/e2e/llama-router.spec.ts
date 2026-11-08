import { test, expect, _electron as electron } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
test("native llama lists, loads and unloads one installed model through a genuine private router", async () => {
  const model = process.env.AMUN_LIVE_LLAMA_GGUF;
  test.skip(!model, "Requires a local GGUF and llama-server");
  test.setTimeout(180000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "amun-router-")));
  const reserve = createServer();
  await new Promise<void>((r) => reserve.listen(0, "127.0.0.1", r));
  const addr = reserve.address();
  if (!addr || typeof addr === "string") throw Error();
  await new Promise<void>((r) => reserve.close(() => r()));
  const url = "http://127.0.0.1:" + addr.port;
  const ini = join(root, "router.ini");
  await writeFile(
    ini,
    "[stow-fixture]\nmodel = " +
      model +
      "\nn-gpu-layers = 0\nctx-size = 2048\n",
  );
  const router = spawn(
    "/opt/homebrew/bin/llama-server",
    [
      "--offline",
      "--host",
      "127.0.0.1",
      "--port",
      String(addr.port),
      "--models-preset",
      ini,
    ],
    {
      env: { HOME: root, PATH: "/opt/homebrew/bin:/usr/bin:/bin" },
      stdio: "ignore",
    },
  );
  const stopped = new Promise((r) => router.once("exit", r));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const catalog = async () =>
      (
        (await (await fetch(url + "/models")).json()) as {
          data: { id: string; status: { value: string } }[];
        }
      ).data.find((m) => m.id === "stow-fixture")?.status.value;
    await expect
      .poll(() => catalog().catch(() => ""), { timeout: 25000 })
      .toBe("unloaded");
    const binary = process.env.AMUN_PACKAGED_PATH;
    app = await electron.launch({
      ...(binary ? { executablePath: binary } : {}),
      args: [
        ...(binary ? [] : ["apps/desktop"]),
        "--user-data-dir=" + join(root, "profile"),
      ],
    });
    const page = await app.firstWindow();
    await expect(page.getByRole("status")).toHaveText("Connected");
    for (const name of ["Open conversations", "Open Pi commands"])
      await page.getByRole("button", { name, exact: true }).click();
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("llama", { timeout: 3000 });
    await page.getByLabel("Command argument", { exact: true }).fill(url);
    await page
      .getByRole("button", { name: "Run command", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Load stow-fixture", exact: true })
      .click({ timeout: 20000 });
    await expect.poll(catalog, { timeout: 90000 }).toBe("loaded");
    await page
      .getByRole("button", { name: "Unload stow-fixture", exact: true })
      .click({ timeout: 30000 });
    await expect.poll(catalog, { timeout: 30000 }).toBe("unloaded");
    await expect(
      page.getByRole("button", { name: "Load stow-fixture", exact: true }),
    ).toBeEnabled({ timeout: 20000 });
  } finally {
    await app?.close();
    router.kill("SIGTERM");
    await stopped;
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
});
