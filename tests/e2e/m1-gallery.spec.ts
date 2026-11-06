import { test, expect, _electron as electron } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("development gallery renders every attention type, size and theme accessibly", async () => {
  test.skip(!!process.env.AMUN_PACKAGED_PATH, "Development-only gallery");
  test.setTimeout(90000);
  const root = await mkdtemp(join(tmpdir(), "amun-gallery-"));
  const app = await electron.launch({
    args: ["apps/desktop", "--amun-gallery", "--user-data-dir=" + root],
  });
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "Component gallery", exact: true }),
    ).toBeVisible();
    await expect(page.locator("[data-gallery-case]")).toHaveCount(132);
    for (const theme of ["tamer-sabry-default", "navy-gold", "navy-cyan"]) {
      await page.getByLabel("Gallery theme").selectOption(theme);
      await expect(page.getByTestId("control-gallery")).toHaveScreenshot(
        `controls-${theme}.png`,
        { scale: "css", animations: "disabled" },
      );
      const results = await new AxeBuilder({ page })
        .setLegacyMode(true)
        .analyze();
      expect(
        results.violations.filter((v) =>
          ["serious", "critical"].includes(v.impact ?? ""),
        ),
      ).toEqual([]);
      for (const size of ["rail", "pill", "card", "expanded"]) {
        const group = page.locator(
          `[data-gallery-theme="${theme}"][data-gallery-size="${size}"]`,
        );
        await expect(group).toHaveScreenshot(`gallery-${theme}-${size}.png`, {
          scale: "css",
          animations: "disabled",
        });
      }
    }
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
