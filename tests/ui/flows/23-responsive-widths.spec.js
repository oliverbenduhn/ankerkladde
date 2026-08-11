const { test, expect } = require('@playwright/test');
const { login, interactionBlockers, snap } = require('../helpers/ux');

test.describe('FLOW 23 — Responsive Workbench-Breiten', () => {
  test('320/375/414/768px bleiben ohne horizontalen Overflow und mit erreichbaren Kernwerkzeugen', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await login(page);

    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: width <= 414 ? 780 : 900 });
      await page.reload();
      await page.locator('#sectionTabs .section-tab').first().waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Einkauf', exact: true }).click();

      const dimensions = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      }));
      expect(
        dimensions.documentWidth,
        `${width}px: Dokumentbreite ${dimensions.documentWidth}px`,
      ).toBeLessThanOrEqual(dimensions.viewportWidth + 1);

      const selectors = ['#searchBtn', '#journalBtn', '#appHeader .btn-settings'];
      for (const selector of selectors) {
        await expect(page.locator(selector), `${width}px: ${selector} nicht sichtbar`).toBeVisible();
      }
      const blockers = await interactionBlockers(page, { selectors });
      expect(blockers, `${width}px: unerreichbare Kernwerkzeuge ${JSON.stringify(blockers)}`).toEqual([]);
      await snap(page, testInfo, `${width}px`);
    }
  });
});
