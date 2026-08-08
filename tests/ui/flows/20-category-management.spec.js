const { test, expect } = require('@playwright/test');
const { login, snap, csrfToken, attachClsListener, readCls, touchTargetsBelowMin } = require('../helpers/ux');

test.describe('FLOW 20 — Kategorie anlegen und umbenennen', () => {
  test.describe.configure({ mode: 'serial' });

  test('settings → Kategorie anlegen → sichtbares Feedback → umbenennen → persistente Navigation', async ({ page }, testInfo) => {
    await attachClsListener(page);
    await login(page);

    await page.getByRole('link', { name: 'Einstellungen' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Einstellungen' });
    const settings = page.locator('#settingsDialogContent');
    await expect(dialog).toBeVisible();
    await expect(settings.getByText('Erscheinungsbild')).toBeVisible();

    const newCategoryPanel = settings.locator('details[data-settings-panel="new-category"]');
    await newCategoryPanel.locator(':scope > summary').click();
    const originalName = `QA Kategorie ${Date.now()}`;
    const renamed = `${originalName} neu`;
    await newCategoryPanel.locator('input[name="name"]').fill(originalName);
    await newCategoryPanel.locator('select[name="type"]').selectOption('list_quantity');
    await newCategoryPanel.getByRole('button', { name: 'Kategorie anlegen' }).click();

    await expect(settings.locator('.settings-flash')).toContainText('Kategorie erstellt');
    await expect(page.locator('#sectionTabs')).toContainText(originalName);
    await snap(page, testInfo, '1-category-created');

    const categoriesPanel = settings.locator('details[data-settings-panel="categories"]');
    if (!(await categoriesPanel.evaluate(panel => panel.open))) {
      await categoriesPanel.locator(':scope > summary').click();
    }
    if (testInfo.project.name === 'mobile') {
      const smallDragHandles = await touchTargetsBelowMin(page, { min: 44, selectors: '.settings-drag-handle' });
      expect.soft(smallDragHandles, `Drag-Handles unter 44px: ${JSON.stringify(smallDragHandles)}`).toEqual([]);
    }
    const row = categoriesPanel.locator('form.settings-category-row', { hasText: originalName });
    await expect(row).toBeVisible();
    await row.locator('summary.settings-category-summary').click();
    await row.locator('input[name="category_name"]').fill(renamed);
    await row.locator('input[name="category_name"]').press('Tab');

    await expect(settings.locator('.settings-flash')).toContainText('gespeichert', { ignoreCase: true });
    await expect(page.locator('#sectionTabs')).toContainText(renamed);
    await snap(page, testInfo, '2-category-renamed');

    // Systemkategorien dürfen keine auswählbare Sackgasse im normalen
    // Erstellungsformular sein. Dieser Check bleibt rot, solange daily_notes
    // trotz Unique-Constraint und API-Verbot angeboten wird.
    const systemTypeOption = settings.locator('select[name="type"] option[value="daily_notes"]');
    await expect(systemTypeOption, 'daily_notes ist systemverwaltet und darf nicht angeboten werden').toHaveCount(0);

    const cls = await readCls(page);
    expect(cls.value, `CLS=${cls.value} entries=${JSON.stringify(cls.entries.slice(0, 5))}`).toBeLessThan(0.1);
  });

  test('Settings-POST blockiert die systemverwaltete Journal-Kategorie freundlich', async ({ page }) => {
    await login(page);
    const name = `QA Unerlaubtes Journal ${Date.now()}`;

    const response = await page.request.post('/settings.php', {
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'fetch',
      },
      form: {
        csrf_token: await csrfToken(page),
        action: 'create_category',
        name,
        type: 'daily_notes',
        icon: 'notizen',
      },
    });

    expect(response.status()).toBe(400);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      flash_type: 'err',
      flash: 'Die Journal-Kategorie wird vom System verwaltet.',
    });

    const categories = await (await page.request.get('/api.php?action=categories_list')).json();
    expect(categories.categories.filter(category => category.type === 'daily_notes')).toHaveLength(1);
    expect(categories.categories.some(category => category.name === name)).toBe(false);
  });

  test('Kategorien lassen sich per Tastatur mit 44px-Bedienelementen verschieben', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Einstellungen' }).first().click();

    const settings = page.locator('#settingsDialogContent');
    const categoriesPanel = settings.locator('details[data-settings-panel="categories"]');
    if (!(await categoriesPanel.evaluate(panel => panel.open))) {
      await categoriesPanel.locator(':scope > summary').click();
    }

    const rows = categoriesPanel.locator('[data-category-list] .settings-category-row');
    expect(await rows.count()).toBeGreaterThan(2);
    const target = rows.nth(1);
    const targetId = await target.getAttribute('data-category-id');
    await target.locator('summary.settings-category-summary').click();

    const moveUp = target.getByRole('button', { name: /nach oben/i });
    const moveDown = target.getByRole('button', { name: /nach unten/i });
    await expect(moveUp).toBeVisible();
    await expect(moveDown).toBeVisible();
    for (const button of [moveUp, moveDown]) {
      const box = await button.boundingBox();
      expect(box).toBeTruthy();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    const responsePromise = page.waitForResponse(response =>
      response.url().includes('settings.php')
      && response.request().postData()?.includes('move_category_up')
    );
    await moveUp.focus();
    await moveUp.press('Enter');
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, flash_type: 'ok' });

    await expect(categoriesPanel.locator('[data-category-list] .settings-category-row').first()).toHaveAttribute('data-category-id', targetId);
    await expect(settings.locator('.settings-flash')).toContainText('Reihenfolge aktualisiert');
    const movedRow = categoriesPanel.locator(`.settings-category-row[data-category-id="${targetId}"]`);
    await expect(movedRow.getByRole('button', { name: /nach oben/i })).toBeDisabled();
  });

  test('fehlgeschlagenes Drag-Reorder wird sichtbar gemeldet und zurückgerollt', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Einstellungen' }).first().click();

    const settings = page.locator('#settingsDialogContent');
    const categoriesPanel = settings.locator('details[data-settings-panel="categories"]');
    if (!(await categoriesPanel.evaluate(panel => panel.open))) {
      await categoriesPanel.locator(':scope > summary').click();
    }

    const rows = categoriesPanel.locator('[data-category-list] .settings-category-row');
    const beforeOrder = await rows.evaluateAll(nodes => nodes.map(node => node.dataset.categoryId));
    expect(beforeOrder.length).toBeGreaterThan(2);

    await page.route('**/settings.php', async route => {
      const request = route.request();
      if (request.method() === 'POST' && request.postData()?.includes('reorder_categories')) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, flash: 'Simulierter Speicherfehler.', flash_type: 'err' }),
        });
        return;
      }
      await route.continue();
    });

    const handleBox = await rows.first().locator('.settings-drag-handle').boundingBox();
    const secondRowBox = await rows.nth(1).boundingBox();
    expect(handleBox).toBeTruthy();
    expect(secondRowBox).toBeTruthy();

    const responsePromise = page.waitForResponse(response =>
      response.url().includes('settings.php')
      && response.request().postData()?.includes('reorder_categories')
    );
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(secondRowBox.x + secondRowBox.width / 2, secondRowBox.y + secondRowBox.height - 2, { steps: 8 });
    await page.mouse.up();
    expect((await responsePromise).status()).toBe(503);

    await expect.poll(() => rows.evaluateAll(nodes => nodes.map(node => node.dataset.categoryId))).toEqual(beforeOrder);
    await expect(settings.locator('.settings-flash-err')).toContainText('Simulierter Speicherfehler');
  });
});
