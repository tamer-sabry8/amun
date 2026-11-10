import { expect, type Page, type Locator } from "@playwright/test";
export async function reach(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let i = 0; i < 240; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw Error("Keyboard could not reach " + (await target.textContent()));
}
