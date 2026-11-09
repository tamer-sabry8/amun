import { test, expect, type Locator } from "@playwright/test";
import { join } from "node:path";
import { access, writeFile } from "node:fs/promises";
import { launchMacWorkspace } from "../support/mac-workspace.ts";
import { reach } from "../support/keyboard.ts";

test("keyboard journey connects its isolated Notion workspace and verifies the existing Document Hub", async () => {
  const root = process.env.AMUN_T054_PROFILE;
  test.skip(
    !process.env.AMUN_T054_CONNECT_NOTION,
    "Explicit live Notion acceptance setup.",
  );
  if (root !== "/private/tmp/amun-m6-keyboard-aIPB0w")
    throw Error("Unexpected profile");
  await access(join(root, "authoring-passed"));
  test.setTimeout(720000);
  const app = await launchMacWorkspace(root);
  try {
    const page = await app.firstWindow();
    await expect(page.locator("#service-status")).toHaveText("Connected");
    const activate = async (control: Locator) => {
      await reach(page, control);
      await page.keyboard.press("Enter");
    };
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    await activate(button("Settings"));
    await reach(page, page.getByLabel("Service", { exact: true }));
    await page.keyboard.press("n");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Sign-in browser")).toHaveValue("edge");
    await activate(button("Connect Notion in browser"));
    await expect(page.getByRole("alert")).toContainText(
      "Notion MCP connected",
      { timeout: 600000 },
    );
    const target = "https://www.notion.so/4103581de3a980338ad4c4b1d6122d30";
    await reach(page, page.getByLabel("Notion destination link"));
    await page.keyboard.insertText(target);
    await activate(button("Check Notion destination"));
    await expect(page.getByRole("alert")).toContainText("Document Hub", {
      timeout: 60000,
    });
    await writeFile(
      join(root, "notion-destination-verified.json"),
      JSON.stringify({ target, verified: true }),
      { mode: 0o600 },
    );
  } finally {
    await app.close();
  }
});
