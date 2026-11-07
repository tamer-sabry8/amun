import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtemp,
  realpath,
  writeFile,
  rm,
  access,
  mkdir,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
test("captain explicitly runs a Mac command and chooses Pi model context", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "amun-shell-e2e-")));
  const outside = await realpath(
    await mkdtemp(join(tmpdir(), "amun-shell-input-")),
  );
  const input = join(outside, "input");
  await writeFile(input, "mac-account-read password=DISPOSABLE_CANARY");
  const cwd = join(root, "pi-workspace"),
    sessions = join(cwd, "sessions");
  await mkdir(sessions, { mode: 0o700, recursive: true });
  const sdk = await import(
    pathToFileURL(
      resolve(
        "runtime/pi/node_modules/@earendil-works/pi-coding-agent/dist/index.js",
      ),
    ).href
  );
  const saved = sdk.SessionManager.create(cwd, sessions);
  saved.appendSessionInfo("Shell context proof");
  saved.appendMessage({
    role: "user",
    content: [{ type: "text", text: "Shell verification fixture" }],
    timestamp: Date.now(),
  });
  const marker = join(outside, "ran");
  const executablePath = process.env.AMUN_PACKAGED_PATH;
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [
      ...(executablePath ? [] : ["apps/desktop"]),
      "--user-data-dir=" + root,
    ],
  });
  try {
    const page = await app.firstWindow();
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    await expect(page.locator("#service-status")).toHaveText("Connected");
    await button("Open conversations").click();
    await button("Open Pi commands").click();
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("resume");
    await button("Run command").click();
    await button("Shell context proof").click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Session change completed",
    );
    for (const prefix of ["!", "!!"]) {
      await button("Read active conversation").click();
      await page
        .getByLabel("Conversation message")
        .fill(prefix + "cat '" + input + "'; touch '" + marker + "'");
      if (prefix === "!") await expect(access(marker)).rejects.toThrow();
      await button(
        prefix === "!"
          ? "Run shell with model context"
          : "Run shell without model context",
      ).click({ timeout: 2200 });
      const output = page.getByTestId("native-pi-result");
      await expect(output).toContainText(
        "mac-account-read password=[REDACTED]",
      );
      await expect(output).not.toContainText("DISPOSABLE_CANARY");
      await expect(output).toContainText(
        prefix === "!"
          ? "Included in Pi model context"
          : "Excluded from Pi model context",
      );
      await access(marker);
    }
    const records = (await readFile(saved.getSessionFile(), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).message)
      .filter((message) => message?.role === "bashExecution");
    expect(records.map((r) => r.excludeFromContext)).toEqual([false, true]);
    expect(JSON.stringify(records)).not.toContain("DISPOSABLE_CANARY");
    expect(sdk.convertToLlm(records)).toHaveLength(1);
    expect(sdk.convertToLlm([records[1]])).toHaveLength(0);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
