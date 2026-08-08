const { test, expect } = require('@playwright/test');
const { login, snap, touchTargetsBelowMin, attachClsListener, readCls } = require('../helpers/ux');

test.describe('FLOW 1 — First-Run Einkaufsliste', () => {
  test('login → einkauf → quick-add → toggle done → clear', async ({ page }, testInfo) => {
    await attachClsListener(page);
    await login(page);
    await snap(page, testInfo, '1-after-login');

    // Einkauf-Tab finden (Default-Liste)
    const einkauf = page.getByRole('button', { name: /^Einkauf/ }).first();
    await einkauf.click();
    await snap(page, testInfo, '2-tab-active');

    // Quick-Add: deterministischer Parser muss Kategorie + Datum + Priorität erlauben
    const input = page.locator('#itemInput');
    await expect(input).toBeVisible();
    const itemName = `QA Flow1 Brot ${Date.now()}`;
    const respPromise = page.waitForResponse(r => r.url().includes('action=quick_add') && r.status() === 201);
    await input.fill(`${itemName} !2`);
    await input.press('Enter');
    const resp = await respPromise;
    const body = await resp.json();
    expect(body.parsed).toMatchObject({ name: itemName, priority: '2' });

    // Item muss sichtbar sein und klickbar
    const card = page.locator(`.item-card`).filter({ hasText: itemName });
    await expect(card).toBeVisible();
    await snap(page, testInfo, '3-item-rendered');

    // Toggle done (App nutzt CSS-Klasse `done`, nicht `is-done`)
    await card.locator('input.toggle').first().click();
    await expect(card).toHaveClass(/\bdone\b/);
    await snap(page, testInfo, '4-item-done');

    // Erledigten Eintrag über die sichtbare Sammelaktion entfernen.
    const clearResponse = page.waitForResponse(r => r.url().includes('action=clear') && r.status() === 200);
    const clearButton = page.locator('#clearDoneBtn');
    await expect(clearButton).toBeVisible();
    await expect(clearButton).toBeEnabled();
    await clearButton.click();
    await clearResponse;
    await expect(card).toHaveCount(0);
    await expect(page.locator('#message')).toContainText('Erledigte Artikel entfernt.');
    await snap(page, testInfo, '5-flow-complete');

    // Layout-Shift-Audit (Interaktionszeitraum) — Google Web Vitals: CLS < 0.1 ist "good"
    const cls = await readCls(page);
    expect(cls.value, `CLS=${cls.value} entries=${JSON.stringify(cls.entries.slice(0,3))}`).toBeLessThan(0.1);
  });
});
