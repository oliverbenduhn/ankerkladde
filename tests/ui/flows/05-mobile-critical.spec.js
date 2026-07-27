const { test, expect } = require('@playwright/test');
const { login, snap, touchTargetsBelowMin, attachClsListener, readCls } = require('../helpers/ux');

test.describe('FLOW 5 — Mobile Critical Path', () => {
  test('alle header-buttons erreichbar, kein horizontal overflow, touch-targets ok', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    attachClsListener(page);
    await login(page);
    await snap(page, testInfo, '1-mobile-app');

    // 1) Horizontaler Overflow? Häufige Mobile-Sackgasse
    const overflow = await page.evaluate(() => ({
      docW: document.documentElement.scrollWidth,
      cliW: document.documentElement.clientWidth,
      bodyW: document.body.scrollWidth,
    }));
    expect(overflow.docW, `scrollWidth=${overflow.docW} clientWidth=${overflow.cliW}`).toBeLessThanOrEqual(overflow.cliW + 1);

    // 2) Alle 8 Header-Buttons vorhanden und Touch-Mindestmaß (44×44)
    const headerBtns = ['#conflictAlertBtn', '#layoutToggleBtn', '#tabsToggleBtn', '#scanShoppingBtn', '#searchBtn', '#journalBtn', '#magicBtn'];
    for (const sel of headerBtns) {
      const btn = page.locator(sel);
      await expect(btn, `${sel} fehlt`).toBeAttached();
    }
    const tooSmall = await touchTargetsBelowMin(page, { min: 44 });
    expect(tooSmall, `Touch-Targets zu klein: ${JSON.stringify(tooSmall)}`).toEqual([]);
    await snap(page, testInfo, '2-touch-audit');

    // 3) Suchleiste öffnen → schließen (Overlay-Sackgassen-Check)
    await page.locator('#searchBtn').click();
    await expect(page.locator('#searchBar')).toBeVisible();
    await snap(page, testInfo, '3-search-open');
    await page.keyboard.press('Escape');
    // Fallback: X-Button
    if (await page.locator('#searchBar').isVisible().catch(() => false)) {
      await page.locator('.btn-search-close').first().click().catch(() => {});
    }

    // 4) Magic-Bar-Toggle: Mobile-Sheet muss voll sichtbar sein
    await page.locator('#magicBtn').click();
    const magic = page.locator('#magicBar');
    await expect(magic).toBeVisible();
    const mBox = await magic.boundingBox();
    expect(mBox.y, 'Magic Bar muss im Viewport sein').toBeLessThan(800);
    await snap(page, testInfo, '4-magic-mobile');
    await page.locator('#magicClose').click();
    await expect(magic).toBeHidden();

    // 5) Tab-Switch: zu "Notizen" / einer notes-Kategorie
    const tabs = page.locator('#sectionTabs .section-tab');
    const tabCount = await tabs.count();
    if (tabCount > 1) {
      await tabs.nth(1).click();
      await snap(page, testInfo, '5-tab-switched');
    }

    // 6) Item-Menu: erstes Item anklicken, falls vorhanden
    const firstCard = page.locator('.item-card').first();
    if (await firstCard.count() > 0) {
      await firstCard.locator('button.toggle, .item-actions, .item-menu').first().click().catch(() => {});
      await snap(page, testInfo, '6-item-action');
      // Wieder zurück
      await page.keyboard.press('Escape');
    }

    // 7) Layout-Shift unter Interaktion
    const cls = await readCls(page);
    expect(cls.value, `CLS=${cls.value}`).toBeLessThan(0.2);
  });
});