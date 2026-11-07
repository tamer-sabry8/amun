import { createHash } from "node:crypto";
import { test, expect, _electron as electron } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mkdtemp,
  realpath,
  writeFile,
  readFile,
  access,
  rm,
} from "node:fs/promises";
test("runs only the reviewed Pi extension copy and presents its native dialog", async () => {
  test.setTimeout(75000);
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "amun-ext-review-")),
  );
  const source = join(root, "local-check.ts"),
    marker = join(root, "extension-loaded");
  const code =
    'import {writeFileSync} from "node:fs";\nexport default function(pi){ writeFileSync(' +
    JSON.stringify(marker) +
    ',"reviewed");pi.registerCommand("local-check",{description:"Local verification",handler:async (_args,ctx)=>{if(await ctx.ui.confirm("Verify reviewed command","Show its result?"))ctx.ui.notify("Reviewed extension result");}});}\n';
  await writeFile(source, code);
  const executablePath = process.env.AMUN_PACKAGED_PATH;
  const launch = () =>
    electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [
        ...(executablePath ? [] : ["apps/desktop"]),
        "--user-data-dir=" + root,
      ],
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    const open = async () => {
      await expect(page.locator("#service-status")).toHaveText("Connected");
      await button("Open conversations").click();
      await button("Open Pi commands").click();
    };
    await open();
    const file = page.waitForEvent("filechooser");
    await button("Review local Pi extension").click({ timeout: 2000 });
    await (await file).setFiles(source);
    await expect(page.getByLabel("Extension source to trust")).toHaveValue(
      code,
      { timeout: 20000 },
    );
    await expect(access(marker)).rejects.toThrow();
    await button("Trust this exact extension").click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Extension installed",
      { timeout: 20000 },
    );
    expect(await readFile(marker, "utf8")).toBe("reviewed");
    await writeFile(source, 'throw new Error("Unreviewed replacement")');
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await open();
    await button("Read active conversation").click();
    await page.getByLabel("Conversation message").fill("/local-check");
    await button("Run /local-check").click();
    await expect(
      page.getByText("Verify reviewed command", { exact: true }),
    ).toBeVisible();
    await button("Confirm extension request").click();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Reviewed extension result",
    );
    await app.close();
    const changedMarker = join(root, "unreviewed-executed");
    await writeFile(
      join(
        root,
        "pi-agent/reviewed-extensions",
        createHash("sha256").update(code).digest("hex") + ".ts",
      ),
      'import {writeFileSync} from "node:fs";export default function(){writeFileSync(' +
        JSON.stringify(changedMarker) +
        ',"unexpected")}',
    );
    app = await launch();
    page = await app.firstWindow();
    await open();
    await button("Manage trusted extensions").click();
    const installed = page.getByRole("button", { name: /^[a-f0-9]{64}$/ });
    await installed.click({ timeout: 5000 });
    await expect(access(changedMarker)).rejects.toThrow();
    await expect(page.getByTestId("native-pi-result")).toContainText(
      "Extension removed.",
    );
    await button("Read active conversation").click();
    await page.getByLabel("Conversation message").fill("/local-check");
    await expect(button("Send message")).toBeDisabled();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
