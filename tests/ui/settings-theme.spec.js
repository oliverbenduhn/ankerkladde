const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

test.describe('Settings Theme Smoke Test', () => {
  test('theme change works and monochrom buttons keep readable contrast', async ({ page }) => {
    await page.goto('/login.php');

    await page.getByLabel('Benutzername').fill('playwright-user');
    await page.getByLabel('Passwort').fill('playwright-pass');
    await page.getByRole('button', { name: 'Anmelden' }).click();

    await expect(page).toHaveURL(/index\.php/);
    await expect(page.locator('#sectionTabs .section-tab').first()).toBeVisible();

    await page.getByRole('link', { name: 'Einstellungen' }).first().click();

    const settingsFrame = page.locator('#settingsDialogContent');
    await expect(settingsFrame.getByText('Erscheinungsbild')).toBeVisible();
    await settingsFrame.locator('details[data-settings-panel="appearance"] > summary').click();

    await settingsFrame.getByText('Hell').click();
    await settingsFrame.locator('input[name="light_theme"][value="monochrom"] + .theme-card').click();

    await expect(page.locator('body')).toHaveAttribute('data-theme', 'monochrom');
    await expect(settingsFrame.locator('.settings-flash')).toContainText('gespeichert', { ignoreCase: true });

    await page.goto('/index.php');
    await expect(page.locator('body')).toHaveAttribute('data-theme', 'monochrom');
    await expect(page.locator('#sectionTabs .section-tab').first()).toBeVisible();
    await page.getByRole('button', { name: 'Einkauf', exact: true }).click();

    const contrast = await page.locator('#itemSubmitBtn').evaluate(element => {
      const style = window.getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        color: style.color,
      };
    });

    expect(contrast.backgroundColor).toBe('rgb(42, 42, 42)');
    expect(contrast.color).toBe('rgb(255, 255, 255)');
  });

  test('theme mode updates the host app before autosave completes', async ({ page }) => {
    await page.goto('/login.php');

    await page.getByLabel('Benutzername').fill('playwright-user');
    await page.getByLabel('Passwort').fill('playwright-pass');
    await page.getByRole('button', { name: 'Anmelden' }).click();

    await expect(page).toHaveURL(/index\.php/);
    await expect(page.locator('#sectionTabs .section-tab').first()).toBeVisible();
    await page.getByRole('link', { name: 'Einstellungen' }).first().click();

    const settingsFrame = page.locator('#settingsDialogContent');
    await expect(settingsFrame.getByText('Erscheinungsbild')).toBeVisible();
    await settingsFrame.locator('details[data-settings-panel="appearance"] > summary').click();

    let releaseAutosave;
    const autosaveBlocked = new Promise(resolve => {
      releaseAutosave = resolve;
    });

    await page.route('**/settings.php**', async route => {
      if (route.request().method() === 'POST') {
        await autosaveBlocked;
      }
      await route.continue();
    });

    await settingsFrame.getByText('Dunkel', { exact: true }).click();

    await expect(page.locator('body')).toHaveAttribute('data-theme', /nachtwache|pier|monochrom-dark|grauton-dark/);

    releaseAutosave();
    await expect(settingsFrame.locator('.settings-flash')).toContainText('gespeichert', { ignoreCase: true });
  });

  test('settings state stays stable after reload', async ({ page }) => {
    await page.goto('/login.php');

    await page.getByLabel('Benutzername').fill('playwright-user');
    await page.getByLabel('Passwort').fill('playwright-pass');
    await page.getByRole('button', { name: 'Anmelden' }).click();

    await expect(page).toHaveURL(/index\.php/);
    await expect(page.locator('#sectionTabs .section-tab').first()).toBeVisible();

    await page.getByRole('link', { name: 'Einstellungen' }).first().click();

    const settingsFrame = page.locator('#settingsDialogContent');
    await expect(settingsFrame.getByText('Erscheinungsbild')).toBeVisible();

    const appearancePanel = settingsFrame.locator('details[data-settings-panel="appearance"]');
    const featuresPanel = settingsFrame.locator('details[data-settings-panel="features"]');
    const categoriesPanel = settingsFrame.locator('details[data-settings-panel="categories"]');
    const newCategoryPanel = settingsFrame.locator('details[data-settings-panel="new-category"]');

    await expect(appearancePanel).toHaveJSProperty('open', false);
    await expect(featuresPanel).toHaveJSProperty('open', false);
    await expect(categoriesPanel).toHaveJSProperty('open', false);
    await expect(newCategoryPanel).toHaveJSProperty('open', false);

    await settingsFrame.locator('details[data-settings-panel="appearance"] > summary').click();
    await settingsFrame.locator('details[data-settings-panel="features"] > summary').click();
    await settingsFrame.locator('details[data-settings-panel="new-category"] > summary').click();

    await expect(appearancePanel).toHaveJSProperty('open', true);
    await expect(featuresPanel).toHaveJSProperty('open', true);
    await expect(categoriesPanel).toHaveJSProperty('open', false);
    await expect(newCategoryPanel).toHaveJSProperty('open', true);

    await page.reload();
    await expect(page).toHaveURL(/(?:view|screen)=settings/);
    await expect(page.locator('#app')).toHaveClass(/settings-view/);

    const reloadedFrame = page.locator('#settingsDialogContent');
    const reloadedAppearancePanel = reloadedFrame.locator('details[data-settings-panel="appearance"]');
    const reloadedFeaturesPanel = reloadedFrame.locator('details[data-settings-panel="features"]');
    const reloadedCategoriesPanel = reloadedFrame.locator('details[data-settings-panel="categories"]');
    const reloadedNewCategoryPanel = reloadedFrame.locator('details[data-settings-panel="new-category"]');

    await expect(reloadedFrame.getByText('Erscheinungsbild')).toBeVisible();
    await expect(reloadedAppearancePanel).toHaveJSProperty('open', true);
    await expect(reloadedFeaturesPanel).toHaveJSProperty('open', true);
    await expect(reloadedCategoriesPanel).toHaveJSProperty('open', false);
    await expect(reloadedNewCategoryPanel).toHaveJSProperty('open', true);
  });

  test('settings keep the inert app visible behind the modal drawer', async ({ page }) => {
    await page.goto('/login.php');

    await page.getByLabel('Benutzername').fill('playwright-user');
    await page.getByLabel('Passwort').fill('playwright-pass');
    await page.getByRole('button', { name: 'Anmelden' }).click();

    await expect(page).toHaveURL(/index\.php/);
    await expect(page.locator('#sectionTabs .section-tab').first()).toBeVisible();
    await page.getByRole('button', { name: 'KI-Assistent' }).first().click();
    await expect(page.locator('#magicBar')).toBeVisible();

    await page.getByRole('link', { name: 'Einstellungen' }).first().click();

    await expect(page.locator('#app')).toHaveClass(/settings-view/);
    await expect(page.locator('#magicBar')).toBeHidden();
    await expect(page.getByRole('button', { name: 'KI-Assistent' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Produktinfos per Scan öffnen' }).first()).toBeVisible();
  });

  test('category rows keep their expanded state when settings are reopened', async ({ page }) => {
    await page.goto('/login.php');

    await page.getByLabel('Benutzername').fill('playwright-user');
    await page.getByLabel('Passwort').fill('playwright-pass');
    await page.getByRole('button', { name: 'Anmelden' }).click();

    await expect(page).toHaveURL(/index\.php/);
    await expect(page.locator('#sectionTabs .section-tab').first()).toBeVisible();

    await page.getByRole('link', { name: 'Einstellungen' }).first().click();

    const settingsFrame = page.locator('#settingsDialogContent');
    await expect(settingsFrame.locator('details[data-settings-panel="categories"] > summary')).toBeVisible();
    await settingsFrame.locator('details[data-settings-panel="categories"] > summary').click();

    const firstCategory = settingsFrame.locator('form.settings-category-row').first();
    const firstCategoryDetails = firstCategory.locator('details.settings-category-details');
    const firstCategorySummary = firstCategory.locator('summary.settings-category-summary');

    await expect(firstCategoryDetails).toHaveJSProperty('open', false);
    await firstCategorySummary.click();
    await expect(firstCategoryDetails).toHaveJSProperty('open', true);

    await page.goto('/index.php');
    await page.getByRole('link', { name: 'Einstellungen' }).first().click();

    const reopenedFrame = page.locator('#settingsDialogContent');
    const reopenedFirstCategory = reopenedFrame.locator('form.settings-category-row').first();
    const reopenedFirstCategoryDetails = reopenedFirstCategory.locator('details.settings-category-details');
    const reopenedFirstCategorySummary = reopenedFirstCategory.locator('summary.settings-category-summary');

    await expect(reopenedFrame.locator('details[data-settings-panel="categories"] > summary')).toBeVisible();
    await expect(reopenedFirstCategoryDetails).toHaveJSProperty('open', true);

    await reopenedFirstCategorySummary.click();
    await expect(reopenedFirstCategoryDetails).toHaveJSProperty('open', false);

    await page.reload();

    const reloadedFrame = page.locator('#settingsDialogContent');
    const reloadedFirstCategoryDetails = reloadedFrame
      .locator('form.settings-category-row')
      .first()
      .locator('details.settings-category-details');

    await expect(reloadedFrame.locator('details[data-settings-panel="categories"] > summary')).toBeVisible();
    await expect(reloadedFirstCategoryDetails).toHaveJSProperty('open', false);
  });

  test('new categories appear in settings and app navigation', async ({ page }) => {
    await page.goto('/login.php');

    await page.getByLabel('Benutzername').fill('playwright-user');
    await page.getByLabel('Passwort').fill('playwright-pass');
    await page.getByRole('button', { name: 'Anmelden' }).click();

    await expect(page).toHaveURL(/index\.php/);
    await page.getByRole('link', { name: 'Einstellungen' }).first().click();

    const settingsFrame = page.locator('#settingsDialogContent');
    const categoryName = `Neue Kategorie ${Date.now()}`;

    await settingsFrame.locator('details[data-settings-panel="new-category"] > summary').click();
    const iconDetails = settingsFrame.locator('details.settings-icon-details');
    await expect(iconDetails).toHaveJSProperty('open', false);
    await expect(settingsFrame.getByRole('radio', { name: 'Automatisch', exact: true })).toBeHidden();
    await settingsFrame.locator('input[name="name"]').fill(categoryName);
    await settingsFrame.getByRole('button', { name: 'Kategorie anlegen' }).click();

    await expect(settingsFrame.locator('.settings-flash')).toContainText('Kategorie erstellt');
    await settingsFrame.locator('details[data-settings-panel="categories"] > summary').click();
    await expect(settingsFrame.locator('form.settings-category-row', { hasText: categoryName })).toBeVisible();
    await expect(page.locator('.section-tab')).toContainText([categoryName]);
  });

  test('bottom category bar drag-scrolls on desktop and does not reorder categories', async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 900 });
    await page.goto('/login.php');

    await page.getByLabel('Benutzername').fill('playwright-user');
    await page.getByLabel('Passwort').fill('playwright-pass');
    await page.getByRole('button', { name: 'Anmelden' }).click();

    await expect(page).toHaveURL(/index\.php/);
    await expect(page.locator('.section-tab').first()).toBeVisible();

    const sectionTabs = page.locator('#sectionTabs');
    await expect(sectionTabs).toBeVisible();

    await expect
      .poll(async () => sectionTabs.evaluate(element => element.scrollWidth > element.clientWidth))
      .toBe(true);

    const beforeOrder = await page.locator('.section-tab').evaluateAll(tabs =>
      tabs.map(tab => tab.getAttribute('aria-label'))
    );

    const box = await sectionTabs.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box.x + box.width - 36, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 36, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => sectionTabs.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);

    const afterOrder = await page.locator('.section-tab').evaluateAll(tabs =>
      tabs.map(tab => tab.getAttribute('aria-label'))
    );
    expect(afterOrder).toEqual(beforeOrder);
  });
});
