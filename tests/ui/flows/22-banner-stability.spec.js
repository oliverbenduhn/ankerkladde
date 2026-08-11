const { test, expect } = require('@playwright/test');
const { login, snap, attachClsListener, resetCls, readCls, interactionBlockers } = require('../helpers/ux');

test.describe('FLOW 22 — Stabile Systembanner', () => {
  test('Offline-Banner erscheint ohne Header-Sprung oder verdeckte Werkzeuge', async ({ page, context }, testInfo) => {
    await attachClsListener(page);
    await login(page);
    await resetCls(page, 'app-ready');

    const header = page.locator('#appHeader');
    const before = await header.boundingBox();
    expect(before).toBeTruthy();

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    const banner = page.locator('#networkStatus');
    await expect(banner).toBeVisible();
    const after = await header.boundingBox();
    expect(after).toBeTruthy();
    expect(Math.abs(after.y - before.y), `Header sprang von y=${before.y} auf y=${after.y}`).toBeLessThanOrEqual(1);

    const coreSelectors = [
      '#searchBtn',
      '#journalBtn',
      '#appHeader .btn-settings',
      '#itemInput',
      '#manualAddBtn',
    ];
    for (const selector of coreSelectors) {
      await expect(page.locator(selector)).toBeInViewport();
    }
    const blockers = await interactionBlockers(page, { selectors: coreSelectors });
    expect(blockers, `Banner verdeckt Kernaktionen: ${JSON.stringify(blockers)}`).toEqual([]);
    await snap(page, testInfo, '1-offline-banner');

    const cls = await readCls(page);
    expect(cls.value, `CLS=${cls.value} entries=${JSON.stringify(cls.entries.slice(0, 5))}`).toBeLessThan(0.1);

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
  });
});
