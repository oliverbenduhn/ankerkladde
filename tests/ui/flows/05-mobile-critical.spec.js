const { test, expect } = require('@playwright/test');
const {
  login,
  snap,
  csrfToken,
  touchTargetsBelowMin,
  interactionBlockers,
  attachClsListener,
  readCls,
  markCls,
  resetCls,
} = require('../helpers/ux');

test.describe('FLOW 5 — Mobile Critical Path', () => {
  test('responsive Werkzeuge erreichbar, Overlays schließbar, Touch-Targets ok', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await attachClsListener(page);
    await login(page);
    const activate = locator => testInfo.project.name === 'mobile' ? locator.tap() : locator.click();

    // Auf Mobile viele gleichartige Zielkategorien erzeugen, damit das
    // Verschiebe-Menü real scrollen muss statt nur den Happy Path abzubilden.
    if (testInfo.project.name === 'mobile') {
      const csrf = await csrfToken(page);
      const categoryPrefix = `QA Move ${Date.now()}`;
      for (let index = 1; index <= 14; index += 1) {
        const response = await page.request.post('/api.php?action=categories_create', {
          headers: { 'X-CSRF-Token': csrf },
          form: { name: `${categoryPrefix} ${index}`, type: 'list_due_date', icon: 'arbeit' },
        });
        expect(response.status()).toBe(201);
      }
      await page.reload();
    }

    // Der vorherige Test darf die gespeicherte letzte Kategorie nicht bestimmen.
    await activate(page.getByRole('button', { name: 'Einkauf', exact: true }));
    await expect(page.locator('#list .item-card').first()).toBeVisible();
    await resetCls(page, 'einkauf-ready');
    await snap(page, testInfo, '1-mobile-app');

    // 1) Horizontaler Overflow? Häufige Mobile-Sackgasse
    const overflow = await page.evaluate(() => ({
      docW: document.documentElement.scrollWidth,
      cliW: document.documentElement.clientWidth,
      bodyW: document.body.scrollWidth,
    }));
    expect(overflow.docW, `scrollWidth=${overflow.docW} clientWidth=${overflow.cliW}`).toBeLessThanOrEqual(overflow.cliW + 1);

    // 2) Sichtbare Header-Werkzeuge vorhanden, erreichbar und mindestens 44×44.
    const headerBtns = ['#layoutToggleBtn', '#tabsToggleBtn', '#scanShoppingBtn', '#searchBtn', '#journalBtn', '#magicBtn', '#appHeader .btn-settings'];
    for (const sel of headerBtns) {
      const btn = page.locator(sel);
      await expect(btn, `${sel} fehlt`).toBeVisible();
    }
    const tooSmall = await touchTargetsBelowMin(page, { min: 44 });
    expect(tooSmall, `Touch-Targets zu klein: ${JSON.stringify(tooSmall)}`).toEqual([]);
    const headerBlockers = await interactionBlockers(page, { selectors: headerBtns });
    expect(headerBlockers, `Header-Blocker: ${JSON.stringify(headerBlockers)}`).toEqual([]);
    await snap(page, testInfo, '2-touch-audit');

    // 3) Suchleiste öffnen → schließen (Overlay-Sackgassen-Check)
    await activate(page.locator('#searchBtn'));
    await expect(page.locator('#searchBar')).toBeVisible();
    await expect(page.locator('#searchInput')).toBeFocused();
    await snap(page, testInfo, '3-search-open');
    await page.keyboard.press('Escape');
    await expect(page.locator('#searchBar')).toBeHidden();

    // 4) Magic-Bar-Toggle: Mobile-Sheet muss voll sichtbar sein
    await activate(page.locator('#magicBtn'));
    const magic = page.locator('#magicBar');
    await expect(magic).toBeVisible();
    const magicBlockers = await interactionBlockers(page, { selectors: ['#magicInput', '#magicSubmit', '#magicClose'] });
    expect(magicBlockers, `Magic-Bar-Blocker: ${JSON.stringify(magicBlockers)}`).toEqual([]);
    await snap(page, testInfo, '4-magic-mobile');
    await activate(page.locator('#magicClose'));
    await expect(magic).toBeHidden();

    // 5) Scanner als echter Modal-Flow: Fokus bleibt im Dialog, Escape stoppt
    // auch einen noch anlaufenden Kamera-Pfad und gibt den Auslöser zurück.
    const scannerTrigger = page.locator('#scanShoppingBtn');
    await activate(scannerTrigger);
    const scanner = page.locator('#scannerOverlay[role="dialog"]');
    await expect(scanner).toBeVisible();
    await expect(scanner).toHaveAttribute('aria-modal', 'true');
    expect(await scanner.evaluate(element => element.contains(document.activeElement))).toBe(true);
    expect(await page.locator('#appHeader').evaluate(element => element.inert)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(scanner).toBeHidden();
    await expect(scannerTrigger).toBeFocused();
    expect(await page.locator('#appHeader').evaluate(element => element.inert)).toBe(false);

    // 6) Reale Kategorie wechseln und sichtbaren Inhalt abwarten.
    await activate(page.getByRole('button', { name: 'Privat', exact: true }));
    await expect(page.locator('#list .item-card').first()).toBeVisible();
    await markCls(page, 'privat-visible');
    await snap(page, testInfo, '5-tab-switched');

    // 7) Item-Menü semantisch öffnen und ohne Sackgasse per Escape schließen.
    const firstCard = page.locator('.item-card').first();
    const itemMenuButton = firstCard.locator('.btn-item-menu');
    await activate(itemMenuButton);
    const itemMenu = page.locator('.item-menu-overlay[role="dialog"]');
    await expect(itemMenu).toBeVisible();
    const focusInsideMenu = await itemMenu.evaluate(element => element.contains(document.activeElement));
    expect.soft(focusInsideMenu, 'Der Aktionsdialog übernimmt beim Öffnen nicht den Fokus').toBe(true);
    await expect.soft(itemMenu.locator('.item-menu-action').first(), 'Die erste Aktion erhält nicht den initialen Fokus').toBeFocused();
    const appIsIsolated = await page.locator('#app').evaluate(element => element.inert);
    expect.soft(appIsIsolated, 'Der App-Hintergrund bleibt bei offenem Aktionsdialog interaktiv').toBe(true);
    await page.keyboard.press('Shift+Tab');
    const shiftTabStayedInside = await itemMenu.evaluate(element => element.contains(document.activeElement));
    expect.soft(shiftTabStayedInside, 'Shift+Tab verlässt den Aktionsdialog').toBe(true);
    if (testInfo.project.name === 'mobile') {
      const smallMenuTargets = await touchTargetsBelowMin(page, { min: 44, selectors: '.item-menu-action' });
      expect.soft(smallMenuTargets, `Menü-Aktionen unter 44px: ${JSON.stringify(smallMenuTargets)}`).toEqual([]);

      await activate(itemMenu.getByRole('button', { name: 'Verschieben', exact: true }));
      const menuActions = itemMenu.locator('.item-menu-actions');
      const scrollState = await menuActions.evaluate(element => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: getComputedStyle(element).overflowY,
        sheetHeight: element.closest('.item-menu-sheet').getBoundingClientRect().height,
        viewportHeight: window.innerHeight,
      }));
      expect(scrollState.scrollHeight, 'Viele Verschiebe-Ziele erzeugen keinen scrollbaren Bereich').toBeGreaterThan(scrollState.clientHeight);
      expect(scrollState.overflowY).toMatch(/auto|scroll/);
      expect(scrollState.sheetHeight).toBeLessThanOrEqual(scrollState.viewportHeight - 30);
      await itemMenu.locator('.item-menu-action').last().scrollIntoViewIfNeeded();
      await expect(itemMenu.locator('.item-menu-action').last()).toBeInViewport();
      await activate(itemMenu.locator('.item-menu-action').last());
    }
    await snap(page, testInfo, '6-item-action');
    await page.keyboard.press('Escape');
    await expect(itemMenu).toHaveCount(0);
    await expect.soft(itemMenuButton, 'Nach Escape kehrt der Fokus nicht zum Auslöser zurück').toBeFocused();
    expect.soft(await page.locator('#app').evaluate(element => element.inert), 'Der App-Hintergrund bleibt nach Escape inert').toBe(false);

    // Erneut öffnen und den sichtbaren Backdrop antippen: auch dieser Pfad
    // schließt und gibt den Fokus an denselben Auslöser zurück.
    await activate(itemMenuButton);
    await expect(itemMenu).toBeVisible();
    if (testInfo.project.name === 'mobile') {
      await itemMenu.tap({ position: { x: 2, y: 2 } });
    } else {
      await itemMenu.click({ position: { x: 2, y: 2 } });
    }
    await expect(itemMenu).toHaveCount(0);
    await expect.soft(itemMenuButton, 'Nach Backdrop-Schließen kehrt der Fokus nicht zurück').toBeFocused();

    // Der Vollbild-Item-Editor folgt demselben Vertrag; sein Escape-Pfad
    // delegiert an die vorhandene (ggf. bestätigungspflichtige) Abbrechen-Logik.
    await activate(itemMenuButton);
    await activate(itemMenu.getByRole('button', { name: 'Bearbeiten', exact: true }));
    const itemEditor = page.locator('#itemEditor');
    await expect(itemEditor).toBeVisible();
    await expect(itemEditor).toHaveAttribute('role', 'dialog');
    await expect(itemEditor).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#itemTitleInput')).toBeFocused();
    expect(await page.locator('#appHeader').evaluate(element => element.inert)).toBe(true);
    if (testInfo.project.name === 'mobile') {
      const smallEditorTargets = await touchTargetsBelowMin(page, { min: 44, selectors: '#itemEditorBack' });
      expect.soft(smallEditorTargets, `Item-Editor-Zurück unter 44px: ${JSON.stringify(smallEditorTargets)}`).toEqual([]);
    }
    await page.locator('#itemEditorBack').focus();
    await page.keyboard.press('Shift+Tab');
    expect(await itemEditor.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(itemEditor).toBeHidden();
    await expect(itemMenuButton).toBeFocused();
    expect(await page.locator('#appHeader').evaluate(element => element.inert)).toBe(false);

    // Auch die Konfliktauflösung ist kein Fokus-Sackgassen-Overlay. Der
    // Konflikt wird nur als Test-Fixture direkt in denselben lokalen Store
    // gelegt; geöffnet und geschlossen wird ausschließlich über die UI.
    await page.evaluate(async () => {
      const { setConflicts } = await import('./js/offline-queue.js');
      setConflicts([{
        type: 'update',
        payload: { id: '1', name: 'QA Fokuskonflikt' },
        status: 409,
        message: 'Testkonflikt',
        failedAt: new Date().toISOString(),
      }]);
    });
    const conflictTrigger = page.locator('#conflictAlertBtn');
    await expect(conflictTrigger).toBeVisible();
    await activate(conflictTrigger);
    const conflictDialog = page.locator('#conflictOverlay[role="dialog"]');
    await expect(conflictDialog).toBeVisible();
    await expect(conflictDialog).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#conflictCloseBtn')).toBeFocused();
    expect(await page.locator('#appHeader').evaluate(element => element.inert)).toBe(true);
    await page.keyboard.press('Shift+Tab');
    expect(await conflictDialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(conflictDialog).toBeHidden();
    await expect(conflictTrigger).toBeFocused();
    expect(await page.locator('#appHeader').evaluate(element => element.inert)).toBe(false);
    await page.evaluate(async () => {
      const { setConflicts } = await import('./js/offline-queue.js');
      setConflicts([]);
    });

    // 8) Layout-Shift unter Interaktion
    const cls = await readCls(page);
    expect(cls.value, `CLS=${cls.value} total=${cls.total} entries=${JSON.stringify(cls.entries.slice(0, 5))}`).toBeLessThan(0.1);
  });

  test('Teilen-Zielauswahl bleibt per Tastatur schließbar und gibt Fokus zurück', async ({ page }) => {
    await login(page);
    await page.goto('/index.php?text=QA%20Share%20Modal');

    const dialog = page.locator('.share-category-overlay[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.locator('.share-category-option').first()).toBeFocused();
    expect(await page.locator('#app').evaluate(element => element.inert)).toBe(true);

    await page.keyboard.press('Shift+Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');

    await expect(dialog).toHaveCount(0);
    expect(await page.locator('#app').evaluate(element => element.inert)).toBe(false);
    await expect(page.locator('#itemInput')).toBeFocused();
    await expect(page.locator('#message')).toContainText('Teilen abgebrochen');
  });
});
