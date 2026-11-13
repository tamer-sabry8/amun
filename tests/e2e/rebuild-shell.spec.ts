import AxeBuilder from "@axe-core/playwright";
import {
  test,
  expect,
  _electron as electron,
  type Page,
} from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// UX rebuild journey in a disposable profile: four-step setup → Welcome →
// first work conversation with a resizable document → the six destinations,
// Island, rail and Settings. No sign-in and no external service is used.
const shots = process.env.AMUN_REBUILD_SHOTS;
async function shot(page: Page, name: string) {
  if (!shots) return;
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: join(shots, name + ".png") });
}
/** WCAG A/AA scan of the current screen; serious and critical issues fail. */
async function scan(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).setLegacyMode(true).analyze();
  const violations = results.violations
    .filter((item) => item.impact === "serious" || item.impact === "critical")
    .map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => node.target.join(" ")).slice(0, 4),
    }));
  expect.soft(violations, label).toEqual([]);
}
const launch = (root: string) =>
  electron.launch({
    args: [
      ...(process.env.AMUN_PACKAGED_PATH ? [] : ["apps/desktop"]),
      "--user-data-dir=" + root,
    ],
    ...(process.env.AMUN_PACKAGED_PATH
      ? { executablePath: process.env.AMUN_PACKAGED_PATH }
      : {}),
    chromiumSandbox: true,
    // playwright.config.ts defaults the other suites to the earlier shell.
    env: { ...(process.env as Record<string, string>), AMUN_LEGACY_SHELL: "0" },
    ...(process.env.AMUN_REBUILD_SCHEME === "dark"
      ? { colorScheme: "dark" as const }
      : {}),
  });

test("setup, Home, first work conversation, destinations, rail and Settings", async () => {
  test.setTimeout(240_000);
  const root = await mkdtemp(join(tmpdir(), "amun-rebuild-"));
  let app = await launch(root);
  try {
    let page = await app.firstWindow();
    await page.setViewportSize({ width: 1360, height: 860 });

    // 1 · AI and models
    await expect(
      page.getByRole("heading", { name: "Let’s power Firstmate" }),
    ).toBeVisible();
    await expect(page.getByText("ChatGPT Plus/Pro")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Check|Verify/ }),
    ).toHaveCount(0);
    await shot(page, "01-setup-models");
    await scan(page, "setup");
    await page.getByRole("button", { name: "Continue" }).click();
    // 2 · Tools: every tool is skippable
    await expect(
      page.getByRole("heading", { name: "Which tools does your team use?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Azure DevOps/ }).click();
    await page.getByRole("button", { name: /Notion/ }).click();
    await shot(page, "02-setup-tools");
    await page.getByRole("button", { name: "Continue" }).click();
    // 3 · How you work: work types, groups, conditional routes
    await expect(
      page.getByRole("heading", { name: "What kind of work do you do?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Products", exact: true }).click();
    await page.getByRole("button", { name: "RFP tracking" }).click();
    await page.getByRole("button", { name: "Employer", exact: true }).click();
    await page.getByLabel("Client delivery tickets").selectOption("ado");
    await page.getByLabel("Everything in this group").selectOption("notion");
    await shot(page, "03-setup-work");
    await page.getByRole("button", { name: "Continue" }).click();
    // 4 · Agents: recommended ones preselected, no Engineer
    await expect(
      page.getByRole("button", { name: /Researcher/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /Engineer/ })).toHaveCount(0);
    await shot(page, "04-setup-agents");
    await page.getByRole("button", { name: "Finish setup" }).click();

    // Welcome: setup did not start any work
    await expect(
      page.getByRole("heading", { name: "Welcome to Amun" }),
    ).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Amun" });
    await expect(nav.getByRole("button")).toContainText([
      "Home",
      "Search",
      "Agents",
      "Council",
      "Roadmap",
      "Sprints",
      "Portfolio",
      "RFPs",
    ]);
    await expect(nav.getByText("Nothing needs you right now.")).toBeVisible();
    await expect(
      page
        .getByRole("complementary", { name: /Activity, downloads/ })
        .getByRole("button"),
    ).toHaveCount(4);
    await shot(page, "05-welcome");
    await scan(page, "welcome");

    // First work: nothing matches, so one card offers where it belongs
    const composer = page.getByLabel("Message Firstmate");
    await composer.fill("Create a product called Agentic Platform");
    await composer.press("Enter");
    await expect(
      page.getByRole("group", { name: "Choose where this belongs" }),
    ).toBeVisible();
    await shot(page, "06-intake-card");
    await page
      .getByRole("button", { name: "New product", exact: true })
      .click();

    // Work session: straight into the conversation, with the group breadcrumb
    await expect(
      page.getByRole("region", { name: "Conversation" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Agentic Platform" }),
    ).toBeVisible();
    await expect(
      page.getByText("Create a product called Agentic Platform"),
    ).toBeVisible();
    await expect(page.getByText("Employer").first()).toBeVisible();
    // No model is signed in for this profile: the turn fails plainly, in place.
    await expect(page.getByRole("alert").first()).toBeVisible({
      timeout: 30_000,
    });
    await shot(page, "07-work-session");

    // Document pane: sidebar collapses, divider resizes, expand and restore
    await page.getByRole("button", { name: "New document" }).click();
    const doc = page.getByRole("region", { name: "Untitled" });
    await expect(doc).toBeVisible();
    await expect(nav.getByRole("button", { name: "Roadmap" })).toHaveAttribute(
      "title",
      "Roadmap",
    );
    const before = (await doc.boundingBox())!.width;
    const divider = page.getByRole("separator", {
      name: "Resize the document",
    });
    await divider.focus();
    for (let step = 0; step < 4; step++) await page.keyboard.press("ArrowLeft");
    await expect
      .poll(async () => (await doc.boundingBox())!.width)
      .toBeGreaterThan(before + 60);
    await doc
      .getByLabel("Untitled")
      .fill("# Agentic Platform\n\nOne-page brief.");
    await shot(page, "08-document-pane");
    await scan(page, "work session with document");
    await page.getByRole("button", { name: "Expand the document" }).click();
    await expect(
      page.getByRole("region", { name: "Conversation" }),
    ).toBeHidden();
    await page
      .getByRole("button", { name: "Restore the conversation" })
      .click();
    await expect(
      page.getByRole("region", { name: "Conversation" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close the document" }).click();
    await expect(
      nav.getByRole("button", { name: "Roadmap" }),
    ).not.toHaveAttribute("title", "Roadmap");

    // RFPs: tracking only; a won RFP waits for signature and BRD
    await nav.getByRole("button", { name: "RFPs" }).click();
    await expect(
      page.getByText(/Writing the response belongs to a separate product/),
    ).toBeVisible();
    await composer.fill("Smart Inspection for DMT");
    await composer.press("Enter");
    await expect(
      page
        .getByRole("region", { name: "Received" })
        .getByText("Smart Inspection for DMT"),
    ).toBeVisible();
    await expect(page.getByText("No response owner").first()).toBeVisible();
    await page.getByLabel("Stage").selectOption("won");
    const handToDelivery = page.getByRole("button", {
      name: "Hand to delivery",
      exact: true,
    });
    await expect(handToDelivery).toBeDisabled();
    await page.getByLabel("Proposal signed").check();
    await page.getByLabel("BRD approved").check();
    await handToDelivery.click();
    await expect(
      page.getByRole("button", { name: "Open delivery project", exact: true }),
    ).toBeVisible();
    await shot(page, "09-rfps");
    await scan(page, "rfps");

    // Portfolio shows the product, the RFP and its delivery project
    await nav.getByRole("button", { name: "Portfolio" }).click();
    await expect(
      page.getByRole("button", { name: /Smart Inspection for DMT delivery/ }),
    ).toBeVisible();
    await shot(page, "10-portfolio");

    // Roadmap: add a draft item, then committing it needs approval
    await nav.getByRole("button", { name: "Roadmap" }).click();
    await page
      .getByLabel("Work area", { exact: true })
      .selectOption({ label: "Agentic Platform" });
    await composer.fill("Bulk upload");
    await composer.press("Enter");
    await expect(
      page.getByRole("region", { name: "Later" }).getByText("Bulk upload"),
    ).toBeVisible();
    await shot(page, "11-roadmap");
    await scan(page, "roadmap");
    await page.getByRole("button", { name: "Commit…" }).click();
    await expect(
      page.getByRole("button", { name: "Approve and publish 1 change" }),
    ).toBeVisible();
    await shot(page, "12-plan-review");
    // The Island carries the same approval and its count
    await page.getByRole("button", { name: "Close the document" }).click();
    await expect(nav.getByRole("region", { name: "Needs you" })).toContainText(
      "Needs your approval",
    );

    // Home lists it; reviewing is not approving
    await nav.getByRole("button", { name: "Home" }).click();
    const attention = page.getByRole("region", {
      name: "Needs your attention",
    });
    await expect(
      attention.getByRole("button", { name: "Review changes" }),
    ).toBeVisible();
    await attention.getByRole("button", { name: "Review changes" }).click();
    await expect(
      attention.getByText(/nothing is published until you approve/),
    ).toBeVisible();
    await shot(page, "13-home-active");
    await scan(page, "home");
    await attention
      .getByRole("button", { name: "Approve and publish 1 change" })
      .click();
    await expect(
      attention.getByText("Nothing needs you right now."),
    ).toBeVisible();

    // Rail: Decisions recorded the approval; Activity shows the result
    await page.getByRole("button", { name: /^Decisions/ }).click();
    await expect(
      page.getByRole("dialog", { name: "Decisions" }).getByText("Approved"),
    ).toBeVisible();
    await shot(page, "14-decisions");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Activity/ }).click();
    await expect(
      page
        .getByRole("dialog", { name: "Activity" })
        .getByText(/Roadmap updated/),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // Sprints, Agents, Council
    await nav.getByRole("button", { name: "Sprints" }).click();
    await expect(
      page.getByText("Preview only · No Azure DevOps changes"),
    ).toBeVisible();
    await page
      .getByLabel("Work area", { exact: true })
      .selectOption({ label: "Agentic Platform" });
    await composer.fill("/sprint plan");
    await composer.press("Enter");
    await expect(page.getByText("Capacity not set · ask team")).toBeVisible();
    await shot(page, "15-sprint-plan");
    await scan(page, "sprints");
    await nav.getByRole("button", { name: "Agents" }).click();
    await expect(page.getByRole("button", { name: /Firstmate/ })).toBeVisible();
    await shot(page, "16-agents");
    await scan(page, "agents");
    await nav.getByRole("button", { name: "Council" }).click();
    await expect(page.getByText(/Advisors are simulations/)).toBeVisible();
    await shot(page, "17-council");
    await scan(page, "council");

    // Settings: the three gates, and the light theme that survives a restart
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "Permissions" })
      .click();
    await expect(
      page.getByText("Writing to Azure DevOps", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Using information across groups", { exact: true }),
    ).toBeVisible();
    await shot(page, "18-permissions");
    await scan(page, "permissions");
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "Themes" })
      .click();
    await page.getByRole("button", { name: /Amun light/ }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "amun-light",
    );
    await shot(page, "19-light-theme");
    await scan(page, "themes, light");

    // ⌘K search finds the work and opens its conversation
    await page.keyboard.press("Meta+k");
    await page.getByLabel("Search work, records and places").fill("agentic");
    await page
      .getByRole("dialog", { name: "Search" })
      .getByRole("button", { name: "Agentic Platform" })
      .click();
    await expect(
      page.getByRole("region", { name: "Conversation" }),
    ).toBeVisible();
    await shot(page, "20-light-session");
    await scan(page, "work session, light");

    await app.close();
    app = await launch(root);
    page = await app.firstWindow();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      "amun-light",
    );
    await expect(
      page.getByRole("heading", { name: "Welcome to Amun" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Agentic Platform/ }).first(),
    ).toBeVisible();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
