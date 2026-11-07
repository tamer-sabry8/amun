import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, mkdir, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("owned Pi template and skill commands expand into an editable draft", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "amun-pi-resources-")),
  );
  const agent = join(root, "pi-agent");
  await mkdir(agent, { mode: 0o700 });
  const prompts = join(agent, "prompts"),
    skill = join(agent, "skills", "summary");
  await mkdir(prompts, { mode: 0o700 });
  await mkdir(skill, { recursive: true, mode: 0o700 });
  await writeFile(join(prompts, "product-review.md"), "Review $1 against $2.", {
    mode: 0o600,
  });
  await writeFile(
    join(skill, "SKILL.md"),
    "---\nname: summary\ndescription: Acceptance summary\n---\nSummarize the supplied decision.",
    { mode: 0o600 },
  );
  const workspace = join(root, "pi-workspace");
  await mkdir(workspace, { mode: 0o700 });
  await writeFile(
    join(workspace, "meeting.md"),
    "Workspace note password=AMUN_PATH_CANARY",
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
    const page = await app.firstWindow();
    await expect(page.locator("#service-status")).toHaveText("Connected");
    const button = (name: string) =>
      page.getByRole("button", { name, exact: true });
    await button("Open conversations").click();
    await button("Open Pi commands").click();
    await button("Read active conversation").click();
    const draft = page.getByLabel("Conversation message");
    await draft.fill("/");
    for (const name of ["product-review", "skill:summary"]) {
      await expect(
        page
          .getByLabel("Choose a slash command")
          .locator("option", { hasText: "/" + name }),
      ).toHaveCount(1);
    }
    await draft.fill('/product-review "phase one" acceptance');
    await button("Apply /product-review").click();
    await expect(draft).toHaveValue("Review phase one against acceptance.");
    await draft.fill("/skill:summary Keep it short.");
    await button("Apply /skill:summary").click();
    await expect(draft).toHaveValue(
      /Summarize the supplied decision[.][\s\S]*Keep it short[.]/,
    );
    await draft.fill("Draft before editing");
    await draft.press("Control+g");
    const editor = page.getByRole("dialog", {
      name: "Edit conversation draft",
    });
    await expect(editor).toBeVisible({ timeout: 1800 });
    await editor.getByLabel("Draft text").fill("First line\nSecond line");
    await editor.getByRole("button", { name: "Apply draft" }).click();
    await expect(draft).toHaveValue("First line\nSecond line");
    await draft.fill("Read @mee");
    await draft.press("Tab");
    await button("Attach meeting.md").click({ timeout: 2500 });
    await expect(draft).toHaveValue(
      /Read[\s\S]*meeting.md[\s\S]*Workspace note password=\[REDACTED\]/,
    );
    await draft.fill("Review the decision @");
    const attachment = join(root, "decision.txt");
    await writeFile(
      attachment,
      "Choose the pilot. password=AMUN_ATTACHMENT_CANARY",
    );
    const picker = page.waitForEvent("filechooser");
    await button("Attach text file").click({ timeout: 2000 });
    await (await picker).setFiles(attachment);
    await expect(draft).toHaveValue(
      /Review the decision[\s\S]*decision.txt[\s\S]*Choose the pilot[\s\S]*REDACTED/,
    );
    expect(await draft.inputValue()).not.toContain("AMUN_ATTACHMENT_CANARY");
    await draft.fill("/unknown-resource");
    await expect(button("Send message")).toBeDisabled();
    await draft.fill("Private unsent text for the original conversation");
    await page
      .getByLabel("Native Pi command", { exact: true })
      .selectOption("new");
    await button("Run command").click();
    await expect(button("Read active conversation")).toBeEnabled();
    await button("Read active conversation").click();
    await expect(draft).toHaveValue("", { timeout: 2000 });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
