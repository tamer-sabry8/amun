import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  readFile,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("pinned Firstmate model selector sets the branch model and reasoning effort", async () => {
  test.setTimeout(120000);
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "amun-supervision-model-")),
  );
  const agent = join(root, "pi-agent");
  await mkdir(agent, { mode: 0o700 });
  await writeFile(
    join(agent, "auth.json"),
    JSON.stringify({
      openai: { type: "api_key", key: "disposable-selection-only" },
    }),
    { mode: 0o600 },
  );
  const executablePath = process.env.AMUN_PACKAGED_PATH;
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [
      ...(executablePath ? [] : ["apps/desktop"]),
      "--user-data-dir=" + root,
    ],
  });
  try {
    const p = await app.firstWindow();
    const btn = (name: string) => p.getByRole("button", { name, exact: true });
    await expect(p.locator("#service-status")).toHaveText("Connected");
    await btn("Open conversations").click();
    await btn("Open Pi commands").click();
    await btn("Read active conversation").click();
    const model = await p.getByText(/^Model: /).innerText();
    await p.getByLabel("Conversation message").fill("/supervision-model");
    await btn("Run /supervision-model").click({ timeout: 2100 });
    await expect(
      p.getByRole("heading", { name: /Supervision branch model/i }),
    ).toBeVisible({ timeout: 35000 });
    await p
      .getByRole("button", { name: /^openai\/gpt-5\.4(?:\s|$)/ })
      .first()
      .click();
    await p
      .getByRole("button", { name: /^low(?:\s|$)/i })
      .first()
      .click();
    await expect(p.getByTestId("native-pi-result")).toContainText(
      "Firstmate supervision",
      { timeout: 15000 },
    );
    const ws = join(root, "workspace"),
      owner = await readFile(join(ws, "firstmate-crew-home"), "utf8");
    const cfg = join(ws, owner, "git/primary/config");
    expect(
      (await readFile(join(cfg, "supervision-branch-model"), "utf8")).trim(),
    ).toBe("openai/gpt-5.4");
    expect(
      (await readFile(join(cfg, "supervision-branch-effort"), "utf8")).trim(),
    ).toBe("low");
    await btn("Read active conversation").click();
    await expect(p.getByText(/^Model: /)).toHaveText(model);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
